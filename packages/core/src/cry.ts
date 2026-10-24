/**
 * Turns per-window crying scores (from YAMNet) into cry episodes.
 * A single loud window (a cough, a dog bark that resembles crying) shouldn't page anyone,
 * so an episode starts only when most of the recent windows agree.
 */
import type { AudioObservation, LuluEvent } from './types';

export interface CryOptions {
  /** Score at or above which a window counts as crying. */
  threshold: number;
  /** Number of recent windows considered. */
  window: number;
  /** How many of those windows must be crying to start an episode. */
  minPositive: number;
  /** Seconds without crying windows before the episode ends. */
  endAfter: number;
  /** Seconds after an episode ends before a new one can alert again. */
  cooldown: number;
  /** Re-alert every this many seconds while crying continues. */
  remindEvery: number;
}

export const DEFAULT_CRY: CryOptions = {
  threshold: 0.35,
  window: 6,
  minPositive: 4,
  endAfter: 20,
  cooldown: 60,
  remindEvery: 300,
};

export class CryDetector {
  private recent: boolean[] = [];
  private episodeStart: number | null = null;
  private lastPositive = -Infinity;
  private lastEnd = -Infinity;
  private lastReminder = 0;
  readonly opts: CryOptions;

  constructor(opts: Partial<CryOptions> = {}) {
    this.opts = { ...DEFAULT_CRY, ...opts };
  }

  get crying(): boolean {
    return this.episodeStart !== null;
  }

  update(a: AudioObservation): LuluEvent[] {
    const o = this.opts;
    const positive = a.cry >= o.threshold;
    this.recent.push(positive);
    if (this.recent.length > o.window) this.recent.shift();
    if (positive) this.lastPositive = a.t;
    const count = this.recent.filter(Boolean).length;
    const events: LuluEvent[] = [];

    if (this.episodeStart === null) {
      if (count >= o.minPositive) {
        this.episodeStart = a.t;
        this.lastReminder = a.t;
        // Starting again right after a short pause counts as the same episode for alerting.
        if (a.t - this.lastEnd >= o.cooldown) {
          events.push({ type: 'cry_detected', severity: 'alert', t: a.t, message: 'Crying detected' });
        }
      }
    } else if (a.t - this.lastPositive >= o.endAfter) {
      const duration = Math.round(this.lastPositive - this.episodeStart);
      events.push({
        type: 'cry_stopped',
        severity: 'info',
        t: a.t,
        message: `Crying stopped after ${formatDuration(duration)}`,
        data: { durationSec: duration },
      });
      this.episodeStart = null;
      this.lastEnd = a.t;
      this.recent = [];
    } else if (a.t - this.lastReminder >= o.remindEvery) {
      this.lastReminder = a.t;
      const mins = Math.round((a.t - this.episodeStart) / 60);
      events.push({ type: 'cry_detected', severity: 'alert', t: a.t, message: `Still crying (${mins} min)`, data: { reminder: true } });
    }
    return events;
  }
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
