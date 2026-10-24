/**
 * Settled / stirring state for one child, from how much their box (and pose, when present)
 * moves over one-second steps. Comparing positions a second apart instead of frame to frame
 * keeps detector jitter from looking like movement. These events feed the sleep log.
 */
import { center } from './geometry';
import type { Box, Landmark } from './types';

export type ActivityState = 'unknown' | 'settled' | 'stirring';

export interface ActivityOptions {
  /** Smoothed movement (box heights per second) above which the child counts as active. */
  activeLevel: number;
  /** Seconds of activity before 'stirring'. */
  stirAfter: number;
  /** Seconds of stillness before 'settled'. */
  settleAfter: number;
}

export const DEFAULT_ACTIVITY: ActivityOptions = { activeLevel: 0.06, stirAfter: 3, settleAfter: 90 };

export class ActivityTracker {
  state: ActivityState = 'unknown';
  level = 0;
  private sampleT: number | null = null;
  private sampleBox: Box | null = null;
  private sampleLm: Landmark[] | null = null;
  private activeSince: number | null = null;
  private stillSince: number | null = null;
  readonly opts: ActivityOptions;

  constructor(opts: Partial<ActivityOptions> = {}) {
    this.opts = { ...DEFAULT_ACTIVITY, ...opts };
  }

  /** Returns the new state when it changes. */
  update(t: number, box: Box, landmarks?: Landmark[]): ActivityState | null {
    if (this.sampleT === null || this.sampleBox === null) {
      this.sampleT = t;
      this.sampleBox = box;
      this.sampleLm = landmarks ?? null;
      this.stillSince = t;
      return null;
    }
    const dt = t - this.sampleT;
    if (dt < 1) return null;

    const h = Math.max(box.h, 1e-3);
    const c0 = center(this.sampleBox);
    const c1 = center(box);
    let m = (Math.abs(c1.x - c0.x) + Math.abs(c1.y - c0.y) + Math.abs(box.h - this.sampleBox.h)) / h;
    if (landmarks && this.sampleLm && landmarks.length === this.sampleLm.length) {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < landmarks.length; i++) {
        const a = landmarks[i];
        const b = this.sampleLm[i];
        if (a.v > 0.5 && b.v > 0.5) {
          sum += Math.hypot(a.x - b.x, a.y - b.y);
          n++;
        }
      }
      if (n >= 5) m = Math.max(m, sum / n / h);
    }
    m /= dt;
    this.level = this.level * 0.6 + m * 0.4;
    this.sampleT = t;
    this.sampleBox = box;
    this.sampleLm = landmarks ?? null;

    const o = this.opts;
    if (this.level > o.activeLevel) {
      this.stillSince = null;
      this.activeSince ??= t;
      if (this.state !== 'stirring' && t - this.activeSince >= o.stirAfter) return (this.state = 'stirring');
    } else {
      this.activeSince = null;
      this.stillSince ??= t;
      if (this.state !== 'settled' && t - this.stillSince >= o.settleAfter) return (this.state = 'settled');
    }
    return null;
  }
}
