/**
 * Turns a noisy per-frame condition into a stable on/off state.
 * The state flips on only after the condition has held for `onAfter` seconds,
 * and back off after it has been false for `offAfter` seconds.
 */
export class Debounce {
  state = false;
  private since: number | null = null;

  constructor(
    private readonly onAfter: number,
    private readonly offAfter: number,
  ) {}

  update(cond: boolean, t: number): 'rise' | 'fall' | null {
    if (cond === this.state) {
      this.since = null;
      return null;
    }
    if (this.since === null) this.since = t;
    if (t - this.since >= (cond ? this.onAfter : this.offAfter)) {
      this.state = cond;
      this.since = null;
      return cond ? 'rise' : 'fall';
    }
    return null;
  }

  reset(): void {
    this.state = false;
    this.since = null;
  }
}

/** Remembers when each key last fired so the same alert isn't repeated too often. */
export class Cooldowns {
  private last = new Map<string, number>();

  ready(key: string, t: number, seconds: number): boolean {
    const prev = this.last.get(key);
    return prev === undefined || t - prev >= seconds;
  }

  mark(key: string, t: number): void {
    this.last.set(key, t);
  }
}
