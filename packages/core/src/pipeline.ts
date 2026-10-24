/**
 * The Lulu decision pipeline. The camera phone feeds it model outputs (detections, poses,
 * crying scores, image stats) and it returns events. The replay harness runs the exact same
 * class on recorded traces, so harness numbers describe what the app actually does.
 */
import { ActivityTracker, type ActivityOptions } from './activity';
import { DEFAULT_HAZARD_CLASSES, PERSON_CLASS } from './coco';
import { CryDetector, type CryOptions } from './cry';
import { Cooldowns, Debounce } from './debounce';
import { boxGap, center, fractionInside, iou, pointInPolygon } from './geometry';
import { HealthMonitor, type HealthOptions } from './health';
import { classifyPosture, type Posture } from './posture';
import { ByteTracker, type ByteTrackOptions, type Track } from './tracking/bytetrack';
import type {
  AudioObservation,
  Box,
  CameraMount,
  Detection,
  FrameObservation,
  LuluEvent,
  Pose,
  TrackSnapshot,
  Zone,
} from './types';

export interface PipelineFeatures {
  cry: boolean;
  zones: boolean;
  posture: boolean;
  hazards: boolean;
  health: boolean;
  activity: boolean;
}

export interface PipelineConfig {
  zones: Zone[];
  mount: CameraMount;
  hazardClasses: Record<number, string>;
  features: PipelineFeatures;
  tracker?: Partial<ByteTrackOptions>;
  cry?: Partial<CryOptions>;
  health?: Partial<HealthOptions>;
  activity?: Partial<ActivityOptions>;
}

export const DEFAULT_FEATURES: PipelineFeatures = {
  cry: true,
  zones: true,
  posture: true,
  hazards: true,
  health: true,
  activity: true,
};

export function defaultConfig(
  partial: Partial<Omit<PipelineConfig, 'features'>> & { features?: Partial<PipelineFeatures> } = {},
): PipelineConfig {
  return {
    zones: [],
    mount: 'overhead',
    hazardClasses: DEFAULT_HAZARD_CLASSES,
    ...partial,
    features: { ...DEFAULT_FEATURES, ...partial.features },
  };
}

/** Seconds a track must sit fully inside a zone before we treat it as a child in that zone. */
const CHILD_AFTER = 2;
/** How close (normalized units) another person must be to count as a caregiver beside the child. */
const CAREGIVER_GAP = 0.05;
const HAZARD_MIN_SCORE = 0.4;
/** Below this fraction of the box inside the zone, the child is at the edge. */
const EDGE_FRACTION = 0.85;

interface ChildState {
  zone: Zone | null;
  fullyInsideSince: number | null;
  isChild: boolean;
  lastFrac: number;
  lastCaregiverT: number;
  edge: Debounce;
  exit: Debounce;
  exitFired: boolean;
  upright: Debounce;
  front: Debounce;
  posture: Posture;
  activity: ActivityTracker;
}

export class Pipeline {
  private config: PipelineConfig;
  private tracker: ByteTracker;
  private cry: CryDetector;
  private health: HealthMonitor;
  private children = new Map<number, ChildState>();
  private cooldowns = new Cooldowns();
  private hazardHits = new Map<number, number[]>();
  private visible: Track[] = [];

  constructor(config: PipelineConfig) {
    this.config = config;
    this.tracker = new ByteTracker(config.tracker);
    this.cry = new CryDetector(config.cry);
    this.health = new HealthMonitor(config.health);
  }

  setZones(zones: Zone[]): void {
    this.config = { ...this.config, zones };
    // Zone membership is re-learned from scratch against the new zones.
    this.children.clear();
  }

  setMount(mount: CameraMount): void {
    this.config = { ...this.config, mount };
  }

  resetCameraReference(): void {
    this.health.resetReference();
  }

  get isCrying(): boolean {
    return this.cry.crying;
  }

  processAudio(a: AudioObservation): LuluEvent[] {
    return this.config.features.cry ? this.cry.update(a) : [];
  }

  processFrame(f: FrameObservation): LuluEvent[] {
    const { t } = f;
    const events: LuluEvent[] = [];
    const persons = f.detections.filter((d) => d.cls === PERSON_CLASS);
    this.visible = this.tracker.update(persons, t);

    if (this.config.features.health) {
      events.push(...this.health.update(t, f.health, f.motion, this.visible.length));
    }

    const confirmed = this.tracker.confirmedTracks;
    const alive = new Set(confirmed.map((tr) => tr.id));
    for (const id of this.children.keys()) if (!alive.has(id)) this.children.delete(id);

    for (const tr of confirmed) {
      const st = this.stateFor(tr);
      if (tr.state === 'tracked') {
        this.updateZone(tr, st, t, events);
        const pose = matchPose(tr.box, f.poses);
        if (st.isChild) {
          this.updatePosture(tr, st, pose, t, events);
          this.updateActivity(tr, st, pose, t, events);
        }
      } else if (tr.state === 'lost' && st.isChild) {
        this.checkVanishedAtEdge(tr, st, t, events);
      }
    }

    if (this.config.features.hazards) this.updateHazards(f.detections, t, events);
    return events;
  }

  /** Tracks currently visible, for drawing boxes over the camera preview. */
  snapshot(): TrackSnapshot[] {
    return this.visible.map((tr) => {
      const st = this.children.get(tr.id);
      return {
        id: tr.id,
        label: tr.label,
        box: tr.box,
        isChild: st?.isChild ?? false,
        zoneId: st?.zone?.id,
        posture: st?.posture,
      };
    });
  }

  private stateFor(tr: Track): ChildState {
    let st = this.children.get(tr.id);
    if (!st) {
      st = {
        zone: null,
        fullyInsideSince: null,
        isChild: false,
        lastFrac: 1,
        lastCaregiverT: -Infinity,
        edge: new Debounce(0.8, 2),
        exit: new Debounce(1.5, 3),
        exitFired: false,
        upright: new Debounce(3, 10),
        front: new Debounce(4, 6),
        posture: 'unknown',
        activity: new ActivityTracker(this.config.activity),
      };
      this.children.set(tr.id, st);
    }
    return st;
  }

  private updateZone(tr: Track, st: ChildState, t: number, events: LuluEvent[]): void {
    const box = tr.box;
    if (!st.isChild) {
      // Become a "child" by staying fully inside a zone. Adults leaning over a crib are only
      // partly inside, so they don't qualify.
      const zone = this.config.zones.find((z) => fractionInside(box, z.points) >= 0.9);
      if (zone) {
        if (st.zone?.id !== zone.id) {
          st.zone = zone;
          st.fullyInsideSince = t;
        }
        if (t - (st.fullyInsideSince ?? t) >= CHILD_AFTER) st.isChild = true;
      } else {
        st.zone = null;
        st.fullyInsideSince = null;
      }
      return;
    }
    if (!this.config.features.zones || !st.zone) return;

    const zone = st.zone;
    const frac = fractionInside(box, zone.points);
    const centerIn = pointInPolygon(center(box), zone.points);
    st.lastFrac = frac;
    if (this.caregiverNear(tr)) st.lastCaregiverT = t;
    const withCaregiver = t - st.lastCaregiverT < 5;

    // Any part of the body past the boundary while the centre is still inside counts as "at the edge".
    const edge = st.edge.update(centerIn && frac < EDGE_FRACTION, t);
    if (edge === 'rise' && !withCaregiver && this.cooldowns.ready(`edge:${tr.id}`, t, 60)) {
      this.cooldowns.mark(`edge:${tr.id}`, t);
      events.push({
        type: 'zone_edge',
        severity: 'warning',
        t,
        track: tr.label,
        message: `Child ${tr.label} is at the edge of the ${zone.name}`,
        data: { zone: zone.id },
      });
    }

    const exit = st.exit.update(!centerIn, t);
    if (exit === 'rise' && withCaregiver) {
      // Carried out by an adult: handled, and the later disappearance shouldn't alert either.
      st.exitFired = true;
    } else if (exit === 'rise' && !st.exitFired) {
      st.exitFired = true;
      events.push({
        type: 'zone_exit',
        severity: 'alert',
        t,
        track: tr.label,
        message: `Child ${tr.label} left the ${zone.name}`,
        data: { zone: zone.id },
      });
    }
    if (exit === 'fall') st.exitFired = false;
  }

  /** A child last seen half over the edge who then vanishes has most likely climbed out. */
  private checkVanishedAtEdge(tr: Track, st: ChildState, t: number, events: LuluEvent[]): void {
    if (!this.config.features.zones || !st.zone || st.exitFired) return;
    if (st.lastFrac >= EDGE_FRACTION || t - tr.lastSeenT < 2) return;
    if (t - st.lastCaregiverT < 10) return;
    st.exitFired = true;
    events.push({
      type: 'zone_exit',
      severity: 'alert',
      t,
      track: tr.label,
      message: `Child ${tr.label} went out of view at the edge of the ${st.zone.name}`,
      data: { zone: st.zone.id, vanished: true },
    });
  }

  private caregiverNear(child: Track): boolean {
    return this.visible.some((other) => {
      if (other.id === child.id) return false;
      if (this.children.get(other.id)?.isChild) return false;
      return boxGap(other.box, child.box) < CAREGIVER_GAP;
    });
  }

  private updatePosture(tr: Track, st: ChildState, pose: Pose | undefined, t: number, events: LuluEvent[]): void {
    if (!this.config.features.posture || !pose || !st.zone) return;
    if (!pointInPolygon(center(tr.box), st.zone.points)) return;
    const reading = classifyPosture(pose.landmarks, this.config.mount);
    st.posture = reading.posture;
    // 'unknown' (blanket, bad angle) holds the previous state rather than resetting it.
    if (reading.posture === 'unknown') return;

    if (st.upright.update(reading.posture === 'upright', t) === 'rise') {
      events.push({
        type: 'sat_up',
        severity: 'warning',
        t,
        track: tr.label,
        message: this.config.mount === 'side' ? `Child ${tr.label} sat or stood up` : `Child ${tr.label} sat up`,
      });
    }
    if (st.front.update(reading.posture === 'lying_front', t) === 'rise') {
      events.push({
        type: 'rolled_over',
        severity: 'alert',
        t,
        track: tr.label,
        message: `Child ${tr.label} may have rolled onto their tummy`,
      });
    }
  }

  private updateActivity(tr: Track, st: ChildState, pose: Pose | undefined, t: number, events: LuluEvent[]): void {
    if (!this.config.features.activity) return;
    const change = st.activity.update(t, tr.box, pose?.landmarks);
    if (change === 'stirring') {
      events.push({ type: 'child_stirring', severity: 'info', t, track: tr.label, message: `Child ${tr.label} is stirring` });
    } else if (change === 'settled') {
      events.push({ type: 'child_settled', severity: 'info', t, track: tr.label, message: `Child ${tr.label} has settled` });
    }
  }

  private updateHazards(detections: Detection[], t: number, events: LuluEvent[]): void {
    const kids = this.visible.filter((tr) => this.children.get(tr.id)?.isChild);
    if (kids.length === 0) {
      this.hazardHits.clear();
      return;
    }
    const nearNow = new Map<number, { name: string; child: Track }>();
    for (const d of detections) {
      const name = this.config.hazardClasses[d.cls];
      if (!name || d.score < HAZARD_MIN_SCORE) continue;
      for (const kid of kids) {
        const zone = this.children.get(kid.id)?.zone;
        const reach = 0.5 * Math.max(kid.box.w, kid.box.h);
        const inZone = zone ? pointInPolygon(center(d.box), zone.points) : false;
        if (inZone || boxGap(d.box, kid.box) < reach) {
          nearNow.set(d.cls, { name, child: kid });
          break;
        }
      }
    }
    // Require the object in at least 3 frames within the last 2 s; one-frame flickers are ignored.
    for (const cls of new Set([...this.hazardHits.keys(), ...nearNow.keys()])) {
      const hits = (this.hazardHits.get(cls) ?? []).filter((ht) => t - ht <= 2);
      const hit = nearNow.get(cls);
      if (hit) hits.push(t);
      this.hazardHits.set(cls, hits);
      if (hit && hits.length >= 3 && this.cooldowns.ready(`hazard:${cls}`, t, 300)) {
        this.cooldowns.mark(`hazard:${cls}`, t);
        events.push({
          type: 'hazard_near',
          severity: 'alert',
          t,
          track: hit.child.label,
          message: `${capitalize(hit.name)} spotted near Child ${hit.child.label}`,
          data: { object: hit.name },
        });
      }
    }
  }
}

function matchPose(box: Box, poses: Pose[] | undefined): Pose | undefined {
  if (!poses?.length) return undefined;
  let best: Pose | undefined;
  let bestIou = 0.3;
  for (const p of poses) {
    const v = iou(box, p.box);
    if (v > bestIou) {
      bestIou = v;
      best = p;
    }
  }
  return best;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
