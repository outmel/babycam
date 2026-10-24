/**
 * Generates the built-in synthetic clips in harness/clips/synthetic-*.
 *
 * Each clip simulates detector output for one scenario (jitter, missed detections, false
 * person boxes, cough-like audio blips, sensor noise) and labels what *should* alert. These
 * clips check the alert logic end to end. They do not measure model accuracy, so for that the
 * harness also runs any recorded clips (from the phone or from `extract/extract_trace.py`).
 *
 *   npm run synth
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  center,
  fractionInside,
  gaussian,
  pointInPolygon,
  rng,
  serializeTrace,
  syntheticPose,
  type Box,
  type CameraMount,
  type Detection,
  type GroundTruthLabel,
  type LabelFile,
  type Pose,
  type SyntheticPosture,
  type TraceHeader,
  type TraceItem,
  type Zone,
} from '../../packages/core/src';

const FPS = 5;
const AUDIO_HZ = 2;
const here = dirname(fileURLToPath(import.meta.url));
const clipsDir = join(here, '..', 'clips');

interface Actor {
  kind: 'child' | 'adult';
  box: (t: number) => Box | null;
  posture?: (t: number) => SyntheticPosture;
}

interface HazardSpec {
  cls: number;
  box: (t: number) => Box | null;
  rate: number;
}

interface Lighting {
  mean: number;
  std: number;
  /** Which background pattern the camera sees (changes when moved). */
  view: number;
  /** Detection miss-rate multiplier (darkness makes the detector worse). */
  missFactor?: number;
}

interface Scenario {
  name: string;
  note: string;
  durationSec: number;
  mount: CameraMount;
  zones: Zone[];
  actors: Actor[];
  hazards?: HazardSpec[];
  /** Ground-truth crying level 0..1 at time t (0 = not crying). */
  cry?: (t: number) => number;
  lighting?: (t: number) => Lighting;
  motion?: (t: number) => number;
  labels: (s: Scenario) => GroundTruthLabel[];
  seed: number;
}

const rect = (id: string, name: string, x: number, y: number, w: number, h: number): Zone => ({
  id,
  name,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

const CRIB = rect('crib', 'crib', 0.25, 0.2, 0.5, 0.65);
const MAT = rect('mat', 'play mat', 0.15, 0.35, 0.7, 0.5);
const normalLight = (): Lighting => ({ mean: 95, std: 38, view: 0 });
const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k));
const between = (t: number, a: number, b: number) => t >= a && t < b;

/** Breathing-scale motion so a sleeping child isn't perfectly still. */
const sleeper = (x: number, y: number, w = 0.14, h = 0.3) => (t: number): Box => ({
  x: x + Math.sin(t * 0.7) * 0.002,
  y: y + Math.sin(t * 0.31) * 0.002,
  w,
  h,
});

/** Labels for leaving a zone, from the true (noise-free) box path. */
function zoneLabels(actor: Actor, zone: Zone, duration: number): GroundTruthLabel[] {
  const labels: GroundTruthLabel[] = [];
  let edgeStart: number | null = null;
  for (let t = 0; t <= duration; t += 1 / FPS) {
    const b = actor.box(t);
    if (!b) continue;
    const frac = fractionInside(b, zone.points);
    const centerIn = pointInPolygon(center(b), zone.points);
    if (centerIn && frac < 0.85) edgeStart ??= t;
    if (!centerIn) {
      if (edgeStart !== null) labels.push({ type: 'zone_edge', start: round(edgeStart), end: round(t) });
      labels.push({ type: 'zone_exit', start: round(t), end: round(t + 10) });
      return labels;
    }
  }
  return labels;
}

const round = (x: number) => Math.round(x * 10) / 10;

const scenarios: Scenario[] = [
  {
    name: 'quiet-night',
    note: '30 minutes of a sleeping baby with a cough, a passing adult and detector noise. Nothing should alert.',
    durationSec: 1800,
    mount: 'overhead',
    zones: [CRIB],
    seed: 1,
    actors: [
      { kind: 'child', box: sleeper(0.43, 0.35), posture: () => 'back' },
      {
        kind: 'adult',
        box: (t) => (between(t, 600, 612) ? { x: lerp(-0.2, 0.9, (t - 600) / 12), y: 0.05, w: 0.25, h: 0.9 } : null),
      },
    ],
    cry: () => 0,
    labels: () => [],
  },
  {
    name: 'climb-out',
    note: 'A toddler moves to the side of the crib and climbs out.',
    durationSec: 180,
    mount: 'overhead',
    zones: [CRIB],
    seed: 2,
    actors: [
      {
        kind: 'child',
        box: (t) => {
          if (t > 120) return null; // out of view after climbing down
          return { x: lerp(0.42, 0.85, (t - 60) / 25), y: 0.4, w: 0.16, h: 0.22 };
        },
        posture: (t) => (t < 55 ? 'back' : 'upright'),
      },
    ],
    labels: (s) => [
      { type: 'sat_up', start: 55, end: 85 },
      ...zoneLabels(s.actors[0], CRIB, s.durationSec),
    ],
  },
  {
    name: 'parent-pickup',
    note: 'A parent walks in, stands at the crib and lifts the baby out. Nothing should alert.',
    durationSec: 180,
    mount: 'overhead',
    zones: [CRIB],
    seed: 3,
    actors: [
      {
        kind: 'child',
        box: (t) => (t < 80 ? sleeper(0.43, 0.35)(t) : t < 95 ? { x: lerp(0.43, 0.8, (t - 80) / 15), y: lerp(0.35, 0.25, (t - 80) / 15), w: 0.14, h: 0.3 } : null),
        posture: () => 'back',
      },
      {
        kind: 'adult',
        box: (t) => {
          if (t < 60 || t > 100) return null;
          const x = t < 70 ? lerp(1.0, 0.55, (t - 60) / 10) : t < 80 ? 0.55 : lerp(0.55, 0.95, (t - 80) / 15);
          return { x, y: 0.05, w: 0.3, h: 0.9 };
        },
      },
    ],
    labels: () => [],
  },
  {
    name: 'cry-episode',
    note: 'Baby wakes and cries on and off for 90 s. Two coughs beforehand should not alert.',
    durationSec: 300,
    mount: 'overhead',
    zones: [CRIB],
    seed: 4,
    actors: [{ kind: 'child', box: sleeper(0.43, 0.35), posture: () => 'back' }],
    cry: (t) => (between(t, 60, 150) ? (Math.sin(t * 0.9) > -0.6 ? 0.75 : 0.15) : 0),
    labels: () => [{ type: 'cry_detected', start: 60, end: 150 }],
  },
  {
    name: 'sit-up',
    note: 'Baby sits up for 30 s, then lies back down.',
    durationSec: 180,
    mount: 'overhead',
    zones: [CRIB],
    seed: 5,
    actors: [
      {
        kind: 'child',
        box: (t) => (between(t, 60, 90) ? { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } : sleeper(0.43, 0.35)(t)),
        posture: (t) => (between(t, 60, 90) ? 'upright' : 'back'),
      },
    ],
    labels: () => [{ type: 'sat_up', start: 60, end: 90 }],
  },
  {
    name: 'roll-over',
    note: 'Baby rolls onto their tummy at 80 s and stays there.',
    durationSec: 180,
    mount: 'overhead',
    zones: [CRIB],
    seed: 6,
    actors: [{ kind: 'child', box: sleeper(0.43, 0.35), posture: (t) => (t >= 80 ? 'front' : 'back') }],
    labels: () => [{ type: 'rolled_over', start: 80, end: 180 }],
  },
  {
    name: 'scissors-nearby',
    note: 'Scissors are left beside the baby (flickering detection). A knife on a far table should not alert.',
    durationSec: 180,
    mount: 'overhead',
    zones: [CRIB],
    seed: 7,
    actors: [{ kind: 'child', box: sleeper(0.43, 0.35), posture: () => 'back' }],
    hazards: [
      { cls: 76, box: (t) => (between(t, 50, 70) ? { x: 0.6, y: 0.45, w: 0.06, h: 0.04 } : null), rate: 0.7 },
      { cls: 43, box: (t) => (between(t, 100, 140) ? { x: 0.88, y: 0.9, w: 0.06, h: 0.03 } : null), rate: 0.7 },
    ],
    labels: () => [{ type: 'hazard_near', start: 50, end: 70 }],
  },
  {
    name: 'lens-covered',
    note: 'A blanket covers the lens for 40 s.',
    durationSec: 180,
    mount: 'overhead',
    zones: [CRIB],
    seed: 8,
    actors: [{ kind: 'child', box: (t) => (between(t, 60, 100) ? null : sleeper(0.43, 0.35)(t)), posture: () => 'back' }],
    lighting: (t) => (between(t, 60, 100) ? { mean: 12, std: 2, view: 0, missFactor: 10 } : normalLight()),
    labels: () => [{ type: 'camera_blocked', start: 60, end: 100 }],
  },
  {
    name: 'lights-off',
    note: 'Room lights go off with no night light.',
    durationSec: 180,
    mount: 'overhead',
    zones: [CRIB],
    seed: 9,
    actors: [{ kind: 'child', box: sleeper(0.43, 0.35), posture: () => 'back' }],
    lighting: (t) => (t >= 60 ? { mean: 18, std: 10, view: 0, missFactor: 4 } : normalLight()),
    labels: () => [{ type: 'camera_dark', start: 60, end: 180 }],
  },
  {
    name: 'camera-bumped',
    note: 'The camera phone is knocked at 90 s and now points elsewhere.',
    durationSec: 180,
    mount: 'overhead',
    zones: [CRIB],
    seed: 10,
    actors: [{ kind: 'child', box: (t) => (t < 90 ? sleeper(0.43, 0.35)(t) : null), posture: () => 'back' }],
    lighting: (t) => ({ ...normalLight(), view: t >= 90 ? 1 : 0 }),
    motion: (t) => (between(t, 90, 90.4) ? 0.6 : 0.01),
    labels: () => [{ type: 'camera_moved', start: 90, end: 100 }],
  },
  {
    name: 'daycare-two-children',
    note: 'Two children on a play mat; one crawls off at ~150 s while staff walk past twice.',
    durationSec: 300,
    mount: 'overhead',
    zones: [MAT],
    seed: 11,
    actors: [
      { kind: 'child', box: (t) => ({ x: 0.3 + Math.sin(t * 0.2) * 0.03, y: 0.5, w: 0.12, h: 0.16 }) },
      {
        kind: 'child',
        box: (t) => (t > 200 ? null : { x: t < 140 ? 0.6 : lerp(0.6, 0.95, (t - 140) / 25), y: 0.55 + Math.sin(t * 0.3) * 0.02, w: 0.12, h: 0.16 }),
      },
      {
        kind: 'adult',
        box: (t) =>
          between(t, 40, 52)
            ? { x: lerp(-0.25, 1.0, (t - 40) / 12), y: 0.0, w: 0.22, h: 0.6 }
            : between(t, 230, 242)
              ? { x: lerp(1.0, -0.25, (t - 230) / 12), y: 0.0, w: 0.22, h: 0.6 }
              : null,
      },
    ],
    labels: (s) => zoneLabels(s.actors[1], MAT, s.durationSec),
  },
];

function backgroundPattern(view: number): number[] {
  const r = rng(1000 + view);
  return Array.from({ length: 256 }, () => 40 + r() * 140);
}

function render(s: Scenario): { header: TraceHeader; items: TraceItem[]; labels: LabelFile } {
  const r = rng(s.seed);
  const items: TraceItem[] = [];
  const patterns = [backgroundPattern(0), backgroundPattern(1)];

  for (let i = 0; i <= s.durationSec * FPS; i++) {
    const t = round(i / FPS);
    const light = s.lighting?.(t) ?? normalLight();
    const miss = 0.08 * (light.missFactor ?? 1);
    const detections: Detection[] = [];
    const poses: Pose[] = [];
    for (const a of s.actors) {
      const b = a.box(t);
      if (!b || r() < miss) continue;
      const j = 0.004;
      const box = {
        x: b.x + gaussian(r) * j,
        y: b.y + gaussian(r) * j,
        w: b.w * (1 + gaussian(r) * 0.02),
        h: b.h * (1 + gaussian(r) * 0.02),
      };
      const base = a.kind === 'child' ? 0.72 : 0.86;
      const score = Math.min(0.98, Math.max(0.2, base + gaussian(r) * 0.08));
      detections.push({ box: roundBox(box), score: round3(score), cls: 0 });
      if (a.posture && r() > 0.1) {
        poses.push({
          box: roundBox(box),
          landmarks: syntheticPose(box, a.posture(t), s.mount, 0.01, r).map((p) => ({ x: round3(p.x), y: round3(p.y), v: round3(p.v) })),
        });
      }
    }
    // Spurious low-confidence person boxes, as real detectors produce.
    if (r() < 0.02) {
      detections.push({ box: roundBox({ x: r() * 0.8, y: r() * 0.8, w: 0.1, h: 0.15 }), score: round3(0.15 + r() * 0.3), cls: 0 });
    }
    for (const h of s.hazards ?? []) {
      const b = h.box(t);
      if (b && r() < h.rate) detections.push({ box: roundBox(b), score: round3(0.45 + r() * 0.3), cls: h.cls });
    }
    const thumb = patterns[light.view].map((v) => Math.round(Math.min(255, Math.max(0, (v - 110) * (light.std / 40) + light.mean + gaussian(r) * 4))));
    const health = { mean: round1(light.mean + gaussian(r) * 1.5), std: round1(Math.max(0.5, light.std + gaussian(r) * 1)), thumb };
    const motion = round3(s.motion?.(t) ?? Math.abs(gaussian(r)) * 0.01);
    items.push({ kind: 'frame', t, detections, poses: poses.length ? poses : undefined, health, motion });
  }

  // Coughs and bumps: isolated high-scoring windows that must not alert.
  const blips = new Set(Array.from({ length: Math.ceil(s.durationSec / 120) }, () => Math.floor(r() * s.durationSec * AUDIO_HZ)));
  for (let i = 0; i <= s.durationSec * AUDIO_HZ; i++) {
    const t = i / AUDIO_HZ;
    const level = s.cry?.(t) ?? 0;
    let cry = level > 0 ? level + gaussian(r) * 0.12 : 0.04 + Math.abs(gaussian(r)) * 0.04;
    if (blips.has(i) && level === 0) cry = 0.55 + r() * 0.3;
    items.push({ kind: 'audio', t, cry: round3(Math.min(1, Math.max(0, cry))) });
  }
  items.sort((a, b) => a.t - b.t);

  const header: TraceHeader = {
    kind: 'header',
    version: 1,
    clip: `synthetic-${s.name}`,
    source: 'synthetic',
    mount: s.mount,
    zones: s.zones,
    durationSec: s.durationSec,
    note: s.note,
  };
  return { header, items, labels: { clip: header.clip, durationSec: s.durationSec, labels: s.labels(s) } };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const roundBox = (b: Box): Box => ({ x: round3(b.x), y: round3(b.y), w: round3(b.w), h: round3(b.h) });

for (const s of scenarios) {
  const { header, items, labels } = render(s);
  const dir = join(clipsDir, header.clip);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'trace.jsonl'), serializeTrace({ header, items }));
  writeFileSync(join(dir, 'labels.json'), JSON.stringify(labels, null, 2) + '\n');
  console.log(`wrote ${header.clip} (${s.durationSec}s, ${labels.labels.length} labels)`);
}
