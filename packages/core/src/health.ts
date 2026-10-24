/**
 * Camera self-checks, so silence is never mistaken for safety: a covered lens, a room too dark
 * to see in, or a camera that has been knocked out of position all raise their own events.
 */
import { Debounce } from './debounce';
import type { HealthSample, LuluEvent } from './types';

export interface HealthOptions {
  /** Luminance std below this means the image is featureless (covered lens or pitch black). */
  blockedStd: number;
  /** Mean luminance below this is too dark for reliable detection. */
  darkMean: number;
  /** Thumbnail correlation with the reference below this means the view changed. */
  movedCorrelation: number;
  /** Accelerometer jolt (g) that suggests the phone was bumped. */
  bumpG: number;
}

export const DEFAULT_HEALTH: HealthOptions = {
  blockedStd: 6,
  darkMean: 30,
  movedCorrelation: 0.5,
  bumpG: 0.15,
};

/** Pearson correlation of two equal-length arrays; robust to overall brightness changes. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da < 1e-6 || db < 1e-6) return da < 1e-6 && db < 1e-6 ? 1 : 0;
  return num / Math.sqrt(da * db);
}

export class HealthMonitor {
  private blocked = new Debounce(5, 3);
  private dark = new Debounce(10, 5);
  private viewChanged = new Debounce(20, 3);
  private reference: number[] | null = null;
  private lastBumpT = -Infinity;
  private bumpPendingSince: number | null = null;
  private referenceT = 0;
  readonly opts: HealthOptions;

  constructor(opts: Partial<HealthOptions> = {}) {
    this.opts = { ...DEFAULT_HEALTH, ...opts };
  }

  get isBlind(): boolean {
    return this.blocked.state || this.dark.state;
  }

  /** Call when the user re-positions the camera on purpose. */
  resetReference(): void {
    this.reference = null;
  }

  update(t: number, h: HealthSample | undefined, motion: number | undefined, peopleInView: number): LuluEvent[] {
    const events: LuluEvent[] = [];
    const o = this.opts;
    if (motion !== undefined && motion >= o.bumpG) this.lastBumpT = t;
    if (!h) return events;

    const isBlocked = h.std < o.blockedStd;
    const isDark = !isBlocked && h.mean < o.darkMean;

    const b = this.blocked.update(isBlocked, t);
    if (b === 'rise') {
      events.push({
        type: 'camera_blocked',
        severity: 'alert',
        t,
        message: "Camera can't see anything. The lens may be covered or the room is completely dark.",
      });
    }
    const d = this.dark.update(isDark, t);
    if (d === 'rise') {
      events.push({ type: 'camera_dark', severity: 'warning', t, message: 'Too dark for reliable alerts. Try a dim night light.' });
    }
    if ((b === 'fall' && !this.dark.state) || (d === 'fall' && !this.blocked.state)) {
      events.push({ type: 'camera_ok', severity: 'info', t, message: 'Camera view is clear again' });
    }

    if (h.thumb && !isBlocked && !isDark) {
      if (!this.reference) {
        this.reference = h.thumb.slice();
        this.referenceT = t;
      } else {
        const corr = correlation(h.thumb, this.reference);
        const recentlyBumped = t - this.lastBumpT < 10;
        // A person walking through also changes the view, so without a bump we need a long,
        // empty-room disagreement before calling it moved.
        const changed = corr < o.movedCorrelation && (recentlyBumped || peopleInView === 0);
        let m: 'rise' | 'fall' | null;
        if (recentlyBumped && changed) {
          m = this.bumpedChange(t);
        } else {
          this.bumpPendingSince = null;
          m = this.viewChanged.update(changed, t);
        }
        if (m === 'rise') {
          events.push({
            type: 'camera_moved',
            severity: 'warning',
            t,
            message: 'The camera seems to have moved. Check it still points at the crib or play area.',
          });
          this.reference = h.thumb.slice();
          this.referenceT = t;
          this.viewChanged.reset();
        }
        // Slowly follow gradual changes (daylight, toys moved) while the room is quiet.
        if (corr > 0.9 && peopleInView === 0 && t - this.referenceT > 600) {
          this.reference = h.thumb.slice();
          this.referenceT = t;
        }
      }
    }
    return events;
  }

  /** After a bump we only need the new view to persist for a few seconds. */
  private bumpedChange(t: number): 'rise' | null {
    if (this.bumpPendingSince === null) this.bumpPendingSince = t;
    if (t - this.bumpPendingSince >= 3) {
      this.bumpPendingSince = null;
      return 'rise';
    }
    return null;
  }
}
