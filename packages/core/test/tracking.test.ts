import { describe, expect, it } from 'vitest';
import { ByteTracker, hungarian, linearAssignment, trackLabel } from '../src';
import type { Detection } from '../src';

const person = (x: number, y: number, score = 0.9, w = 0.2, h = 0.3): Detection => ({ box: { x, y, w, h }, score, cls: 0 });

describe('assignment', () => {
  it('finds the optimal assignment', () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const a = hungarian(cost);
    const total = a.reduce((s, j, i) => s + cost[i][j], 0);
    expect(total).toBe(5);
  });

  it('leaves pairs above the cost limit unmatched', () => {
    const r = linearAssignment([[0.1, 0.95], [0.9, 0.99]], 0.8);
    expect(r.matches).toEqual([[0, 0]]);
    expect(r.unmatchedRows).toEqual([1]);
    expect(r.unmatchedCols).toEqual([1]);
  });

  it('handles empty inputs', () => {
    expect(linearAssignment([], 0.8).matches).toEqual([]);
    expect(linearAssignment([[], []], 0.8).unmatchedRows).toEqual([0, 1]);
  });
});

describe('ByteTracker', () => {
  it('keeps stable anonymous labels for two moving people', () => {
    const tr = new ByteTracker();
    let labels: string[] = [];
    for (let i = 0; i < 30; i++) {
      const t = i * 0.2;
      const out = tr.update([person(0.1 + i * 0.005, 0.2), person(0.6 - i * 0.003, 0.5)], t);
      labels = out.map((x) => x.label).sort();
    }
    expect(labels).toEqual(['A', 'B']);
  });

  it('recovers a track through low-confidence frames (partial occlusion)', () => {
    const tr = new ByteTracker();
    for (let i = 0; i < 10; i++) tr.update([person(0.3, 0.3)], i * 0.2);
    for (let i = 10; i < 15; i++) {
      const out = tr.update([person(0.3, 0.3, 0.3)], i * 0.2);
      expect(out.map((x) => x.label)).toEqual(['A']);
    }
    expect(tr.update([person(0.3, 0.3)], 3.2).map((x) => x.label)).toEqual(['A']);
  });

  it('re-finds a briefly lost track and drops it after the timeout', () => {
    const tr = new ByteTracker({ lostTimeout: 2 });
    for (let i = 0; i < 10; i++) tr.update([person(0.3, 0.3)], i * 0.2);
    tr.update([], 2.0);
    tr.update([], 2.5);
    expect(tr.update([person(0.3, 0.3)], 2.8).map((x) => x.label)).toEqual(['A']);
    tr.update([], 3.0);
    tr.update([], 6.0);
    // New object after the old track expired gets a new label.
    tr.update([person(0.3, 0.3)], 6.2);
    expect(tr.update([person(0.3, 0.3)], 6.4).map((x) => x.label)).toEqual(['B']);
  });

  it('does not start tracks from single low-score flickers', () => {
    const tr = new ByteTracker();
    tr.update([person(0.5, 0.5, 0.55)], 0);
    expect(tr.update([], 0.2)).toEqual([]);
  });

  it('labels beyond Z continue with AA', () => {
    expect(trackLabel(0)).toBe('A');
    expect(trackLabel(25)).toBe('Z');
    expect(trackLabel(26)).toBe('AA');
  });
});
