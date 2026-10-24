/**
 * ByteTrack (Zhang et al., 2022) for anonymous multi-person tracking.
 *
 * Tracks carry only a number and a letter label ("A", "B", ...). Nothing about appearance is
 * stored, so a child who leaves the frame and comes back later gets a new label. That keeps
 * tracking anonymous, which matters in daycare rooms.
 */
import { iou } from '../geometry';
import type { Box, Detection } from '../types';
import { linearAssignment } from './assignment';
import { initiate, predict, update, type KalmanState } from './kalman';

export type TrackState = 'tracked' | 'lost' | 'removed';

export interface ByteTrackOptions {
  /** Detections at or above this score take part in the first association. */
  trackThresh: number;
  /** Detections between this and trackThresh are used in the second association. */
  lowThresh: number;
  /** Minimum score to start a new track. */
  newTrackThresh: number;
  /** IoU-cost limit for the first association. */
  matchThresh: number;
  /** Seconds a lost track is kept before it is removed. */
  lostTimeout: number;
}

export const DEFAULT_BYTETRACK: ByteTrackOptions = {
  trackThresh: 0.5,
  lowThresh: 0.1,
  newTrackThresh: 0.6,
  matchThresh: 0.8,
  lostTimeout: 5,
};

export function trackLabel(index: number): string {
  let s = '';
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function toXyah(b: Box): number[] {
  return [b.x + b.w / 2, b.y + b.h / 2, b.w / Math.max(b.h, 1e-6), b.h];
}

export class Track {
  /** Public id, assigned once the track is confirmed. 0 while unconfirmed. */
  id = 0;
  label = '';
  state: TrackState = 'tracked';
  confirmed = false;
  score: number;
  startT: number;
  lastSeenT: number;
  private kf: KalmanState;

  constructor(det: Detection, t: number) {
    this.kf = initiate(toXyah(det.box));
    this.score = det.score;
    this.startT = t;
    this.lastSeenT = t;
  }

  get box(): Box {
    const [cx, cy, a, h] = this.kf.mean;
    const w = a * h;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  predict(): void {
    // Freeze size velocity for lost tracks so boxes don't collapse while unobserved.
    if (this.state !== 'tracked') this.kf.mean[7] = 0;
    this.kf = predict(this.kf);
  }

  observe(det: Detection, t: number): void {
    this.kf = update(this.kf, toXyah(det.box));
    this.score = det.score;
    this.lastSeenT = t;
    this.state = 'tracked';
  }
}

function iouCost(tracks: Track[], dets: Detection[], fuseScore: boolean): number[][] {
  return tracks.map((tr) =>
    dets.map((d) => {
      const sim = iou(tr.box, d.box);
      return 1 - (fuseScore ? sim * d.score : sim);
    }),
  );
}

export class ByteTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private frames = 0;
  readonly opts: ByteTrackOptions;

  constructor(opts: Partial<ByteTrackOptions> = {}) {
    this.opts = { ...DEFAULT_BYTETRACK, ...opts };
  }

  /** Feed one frame of person detections. Returns confirmed tracks seen this frame. */
  update(detections: Detection[], t: number): Track[] {
    this.frames++;
    const o = this.opts;
    const high = detections.filter((d) => d.score >= o.trackThresh);
    const low = detections.filter((d) => d.score >= o.lowThresh && d.score < o.trackThresh);

    const unconfirmed = this.tracks.filter((tr) => tr.state === 'tracked' && !tr.confirmed);
    const pool = this.tracks.filter((tr) => tr.confirmed && tr.state !== 'removed');
    pool.forEach((tr) => tr.predict());

    // 1st association: confirmed + lost tracks vs high-score detections.
    const a1 = linearAssignment(iouCost(pool, high, true), o.matchThresh, high.length);
    for (const [i, j] of a1.matches) pool[i].observe(high[j], t);

    // 2nd association: still-unmatched tracked tracks vs low-score detections (occlusion recovery).
    const remaining = a1.unmatchedRows.map((i) => pool[i]).filter((tr) => tr.state === 'tracked');
    const a2 = linearAssignment(iouCost(remaining, low, false), 0.5, low.length);
    for (const [i, j] of a2.matches) remaining[i].observe(low[j], t);
    for (const i of a2.unmatchedRows) remaining[i].state = 'lost';

    // Unconfirmed tracks vs leftover high detections.
    const leftover = a1.unmatchedCols.map((j) => high[j]);
    const a3 = linearAssignment(iouCost(unconfirmed, leftover, true), 0.7, leftover.length);
    for (const [i, j] of a3.matches) {
      const tr = unconfirmed[i];
      tr.observe(leftover[j], t);
      this.confirm(tr);
    }
    for (const i of a3.unmatchedRows) unconfirmed[i].state = 'removed';

    // New tracks. On the very first frame they're confirmed immediately (as in ByteTrack).
    for (const j of a3.unmatchedCols) {
      const det = leftover[j];
      if (det.score < o.newTrackThresh) continue;
      const tr = new Track(det, t);
      if (this.frames === 1) this.confirm(tr);
      this.tracks.push(tr);
    }

    for (const tr of this.tracks) {
      if (tr.state === 'lost' && t - tr.lastSeenT > o.lostTimeout) tr.state = 'removed';
    }
    this.removeDuplicates();
    this.tracks = this.tracks.filter((tr) => tr.state !== 'removed');
    return this.tracks.filter((tr) => tr.confirmed && tr.state === 'tracked');
  }

  /** All confirmed tracks that are not removed (tracked or temporarily lost). */
  get confirmedTracks(): Track[] {
    return this.tracks.filter((tr) => tr.confirmed);
  }

  reset(): void {
    this.tracks = [];
    this.frames = 0;
  }

  private confirm(tr: Track): void {
    if (tr.confirmed) return;
    tr.confirmed = true;
    tr.id = this.nextId++;
    tr.label = trackLabel(tr.id - 1);
  }

  /** A tracked and a lost track covering the same object: keep the longer-lived one. */
  private removeDuplicates(): void {
    const tracked = this.tracks.filter((tr) => tr.confirmed && tr.state === 'tracked');
    const lost = this.tracks.filter((tr) => tr.confirmed && tr.state === 'lost');
    for (const a of tracked) {
      for (const b of lost) {
        if (b.state === 'removed' || a.state === 'removed') continue;
        if (1 - iou(a.box, b.box) < 0.15) {
          const aAge = a.lastSeenT - a.startT;
          const bAge = b.lastSeenT - b.startT;
          if (aAge >= bAge) b.state = 'removed';
          else a.state = 'removed';
        }
      }
    }
  }
}
