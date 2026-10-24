/**
 * Scores emitted events against hand-labelled ground truth.
 *
 * - An event is a true positive if it falls inside a labelled interval of the same type
 *   (from `before` seconds before its start to `after` seconds after its end).
 * - Extra events inside an already-matched interval are duplicates. They're reported but not
 *   counted as false alarms.
 * - Any other event of an evaluated type is a false alarm.
 * - A labelled interval with no matching event is a missed alert.
 */
import type { EventType, LuluEvent } from './types';

export interface GroundTruthLabel {
  type: EventType;
  start: number;
  end: number;
  note?: string;
}

export interface LabelFile {
  clip: string;
  durationSec: number;
  labels: GroundTruthLabel[];
}

export const EVALUATED_TYPES: EventType[] = [
  'cry_detected',
  'zone_edge',
  'zone_exit',
  'sat_up',
  'rolled_over',
  'hazard_near',
  'camera_blocked',
  'camera_dark',
  'camera_moved',
];

export interface TypeScore {
  type: EventType;
  truePositives: number;
  falseAlarms: number;
  missed: number;
  duplicates: number;
  /** Labelled intervals of this type. */
  labelled: number;
  precision: number | null;
  recall: number | null;
  latencies: number[];
}

export interface ClipScore {
  clip: string;
  durationSec: number;
  byType: TypeScore[];
  falseAlarmEvents: LuluEvent[];
  missedLabels: GroundTruthLabel[];
}

export interface MatchOptions {
  before: number;
  after: number;
  types: EventType[];
}

export const DEFAULT_MATCH: MatchOptions = { before: 2, after: 5, types: EVALUATED_TYPES };

export function scoreClip(events: LuluEvent[], labels: LabelFile, opts: Partial<MatchOptions> = {}): ClipScore {
  const o = { ...DEFAULT_MATCH, ...opts };
  const byType: TypeScore[] = [];
  const falseAlarmEvents: LuluEvent[] = [];
  const missedLabels: GroundTruthLabel[] = [];

  for (const type of o.types) {
    const evs = events.filter((e) => e.type === type).sort((a, b) => a.t - b.t);
    const gts = labels.labels.filter((l) => l.type === type).sort((a, b) => a.start - b.start);
    const matched = new Array(gts.length).fill(false);
    const latencies: number[] = [];
    let tp = 0;
    let fa = 0;
    let dup = 0;
    for (const e of evs) {
      const idx = gts.findIndex((g, i) => !matched[i] && e.t >= g.start - o.before && e.t <= g.end + o.after);
      if (idx >= 0) {
        matched[idx] = true;
        tp++;
        latencies.push(Math.max(0, e.t - gts[idx].start));
        continue;
      }
      const inMatched = gts.some((g, i) => matched[i] && e.t >= g.start - o.before && e.t <= g.end + o.after);
      if (inMatched) dup++;
      else {
        fa++;
        falseAlarmEvents.push(e);
      }
    }
    gts.forEach((g, i) => !matched[i] && missedLabels.push(g));
    const missed = matched.filter((m) => !m).length;
    byType.push({
      type,
      truePositives: tp,
      falseAlarms: fa,
      missed,
      duplicates: dup,
      labelled: gts.length,
      precision: tp + fa === 0 ? null : tp / (tp + fa),
      recall: gts.length === 0 ? null : tp / gts.length,
      latencies,
    });
  }
  return { clip: labels.clip, durationSec: labels.durationSec, byType, falseAlarmEvents, missedLabels };
}

export interface SuiteSummary {
  clips: number;
  hours: number;
  byType: (TypeScore & { falseAlarmsPerHour: number; medianLatency: number | null })[];
  totals: { truePositives: number; falseAlarms: number; missed: number; falseAlarmsPerHour: number; recall: number | null };
}

export function summarize(scores: ClipScore[]): SuiteSummary {
  const hours = scores.reduce((s, c) => s + c.durationSec, 0) / 3600;
  const types = new Map<EventType, TypeScore>();
  for (const c of scores) {
    for (const ts of c.byType) {
      const acc = types.get(ts.type) ?? {
        type: ts.type, truePositives: 0, falseAlarms: 0, missed: 0, duplicates: 0, labelled: 0,
        precision: null, recall: null, latencies: [],
      };
      acc.truePositives += ts.truePositives;
      acc.falseAlarms += ts.falseAlarms;
      acc.missed += ts.missed;
      acc.duplicates += ts.duplicates;
      acc.labelled += ts.labelled;
      acc.latencies.push(...ts.latencies);
      types.set(ts.type, acc);
    }
  }
  const byType = [...types.values()].map((ts) => ({
    ...ts,
    precision: ts.truePositives + ts.falseAlarms === 0 ? null : ts.truePositives / (ts.truePositives + ts.falseAlarms),
    recall: ts.labelled === 0 ? null : ts.truePositives / ts.labelled,
    falseAlarmsPerHour: hours > 0 ? ts.falseAlarms / hours : 0,
    medianLatency: median(ts.latencies),
  }));
  const tp = byType.reduce((s, t) => s + t.truePositives, 0);
  const fa = byType.reduce((s, t) => s + t.falseAlarms, 0);
  const missed = byType.reduce((s, t) => s + t.missed, 0);
  return {
    clips: scores.length,
    hours,
    byType,
    totals: {
      truePositives: tp,
      falseAlarms: fa,
      missed,
      falseAlarmsPerHour: hours > 0 ? fa / hours : 0,
      recall: tp + missed === 0 ? null : tp / (tp + missed),
    },
  };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
