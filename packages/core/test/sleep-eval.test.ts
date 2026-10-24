import { describe, expect, it } from 'vitest';
import { scoreClip, summarize, summarizeNight } from '../src';
import type { LuluEvent, StoredEvent } from '../src';

const at = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m);

describe('summarizeNight', () => {
  const evening = at(20, 12, 0);

  it('builds a night from settle/stir/cry events', () => {
    const events: StoredEvent[] = [
      { type: 'child_settled', occurredAt: at(20, 19, 40) },
      { type: 'child_stirring', occurredAt: at(20, 23, 0) },
      { type: 'child_settled', occurredAt: at(20, 23, 2) }, // brief stir
      { type: 'cry_detected', occurredAt: at(21, 1, 10) },
      { type: 'cry_stopped', occurredAt: at(21, 1, 16), data: { durationSec: 360 } },
      { type: 'child_settled', occurredAt: at(21, 1, 30) },
      { type: 'zone_edge', occurredAt: at(21, 3, 0) },
      { type: 'child_stirring', occurredAt: at(21, 6, 45) },
      { type: 'child_settled', occurredAt: at(20, 14, 0) }, // nap, outside window
    ];
    const s = summarizeNight(events, evening, { now: at(21, 12, 0) });
    expect(s.date).toBe('2026-10-20');
    expect(s.settledAt).toEqual(at(20, 19, 40));
    expect(s.wakeUps).toHaveLength(1);
    expect(s.wakeUps[0].cried).toBe(true);
    expect(s.briefStirs).toBe(1);
    expect(s.upAt).toEqual(at(21, 6, 45));
    expect(s.cryCount).toBe(1);
    expect(s.cryMinutes).toBe(6);
    // 19:40→23:00 (200) + 23:02→01:10 (128) + 01:30→06:45 (315)
    expect(s.sleepMinutes).toBe(643);
    expect(s.text).toContain('Settled at 7:40 pm.');
    expect(s.text).toContain('Up for the day at 6:45 am.');
  });

  it('handles a night with no sleep data', () => {
    const s = summarizeNight([], evening, { now: at(21, 12, 0) });
    expect(s.settledAt).toBeNull();
    expect(s.text).toBe('No settled sleep was recorded.');
  });
});

describe('scoreClip', () => {
  const ev = (type: LuluEvent['type'], t: number): LuluEvent => ({ type, t, severity: 'alert', message: '' });

  it('counts hits, duplicates, false alarms and misses', () => {
    const score = scoreClip(
      [ev('cry_detected', 31), ev('cry_detected', 80), ev('cry_detected', 300), ev('zone_exit', 50)],
      {
        clip: 'x',
        durationSec: 600,
        labels: [
          { type: 'cry_detected', start: 30, end: 90 },
          { type: 'sat_up', start: 100, end: 120 },
        ],
      },
    );
    const cry = score.byType.find((s) => s.type === 'cry_detected')!;
    expect(cry).toMatchObject({ truePositives: 1, duplicates: 1, falseAlarms: 1, missed: 0 });
    expect(score.byType.find((s) => s.type === 'sat_up')!.missed).toBe(1);
    expect(score.byType.find((s) => s.type === 'zone_exit')!.falseAlarms).toBe(1);

    const suite = summarize([score]);
    expect(suite.totals.falseAlarmsPerHour).toBeCloseTo(12);
    expect(suite.byType.find((s) => s.type === 'cry_detected')!.medianLatency).toBe(1);
  });
});
