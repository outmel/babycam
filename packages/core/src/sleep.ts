/**
 * Nightly sleep summary built only from stored event rows (type + time). No video is needed.
 *
 * Event rows don't identify children across a whole night (track labels are anonymous and
 * reset), so the summary describes the room, which works for one child per camera.
 */
import type { EventType } from './types';

export interface StoredEvent {
  type: EventType | string;
  occurredAt: Date | string;
  data?: Record<string, unknown> | null;
}

export interface WakeEpisode {
  start: Date;
  end: Date | null;
  cried: boolean;
}

export interface NightSummary {
  /** Evening date, YYYY-MM-DD in local time. */
  date: string;
  settledAt: Date | null;
  upAt: Date | null;
  sleepMinutes: number;
  wakeUps: WakeEpisode[];
  briefStirs: number;
  cryCount: number;
  cryMinutes: number;
  alerts: Partial<Record<string, number>>;
  text: string;
}

export interface NightOptions {
  /** Local hour the night window opens on the evening date. */
  startHour: number;
  /** Local hour the window closes the next morning. */
  endHour: number;
  /** Wake-ups starting at or after this hour that never re-settle count as "up for the day". */
  morningHour: number;
  /** Stirs shorter than this (minutes) without crying are "brief stirs", not wake-ups. */
  minWakeMinutes: number;
  now: Date;
}

const ALERT_LABELS: Partial<Record<string, string>> = {
  zone_exit: 'left the safe zone',
  zone_edge: 'at the zone edge',
  sat_up: 'sat up',
  rolled_over: 'rolled over',
  hazard_near: 'object nearby',
  camera_blocked: 'camera blocked',
  camera_dark: 'too dark',
  camera_moved: 'camera moved',
  camera_offline: 'camera offline',
};

export function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function formatClock(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function nightWindow(evening: Date, startHour = 18, endHour = 10): [Date, Date] {
  const start = new Date(evening.getFullYear(), evening.getMonth(), evening.getDate(), startHour, 0, 0, 0);
  const end = new Date(evening.getFullYear(), evening.getMonth(), evening.getDate() + 1, endHour, 0, 0, 0);
  return [start, end];
}

export function summarizeNight(events: StoredEvent[], evening: Date, opts: Partial<NightOptions> = {}): NightSummary {
  const o: NightOptions = { startHour: 18, endHour: 10, morningHour: 5, minWakeMinutes: 5, now: new Date(), ...opts };
  const [winStart, winEnd] = nightWindow(evening, o.startHour, o.endHour);
  const evs = events
    .map((e) => ({ ...e, at: new Date(e.occurredAt) }))
    .filter((e) => e.at >= winStart && e.at < winEnd)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const isCryStart = (e: (typeof evs)[number]) => e.type === 'cry_detected' && !e.data?.reminder;
  const cryCount = evs.filter(isCryStart).length;
  const crySeconds = evs
    .filter((e) => e.type === 'cry_stopped')
    .reduce((s, e) => s + (Number(e.data?.durationSec) || 0), 0);
  const alerts: Partial<Record<string, number>> = {};
  for (const e of evs) if (ALERT_LABELS[e.type]) alerts[e.type] = (alerts[e.type] ?? 0) + 1;

  const firstSettle = evs.find((e) => e.type === 'child_settled');
  const settledAt = firstSettle?.at ?? null;
  const wakes: WakeEpisode[] = [];
  let briefStirs = 0;
  let sleepMs = 0;
  let upAt: Date | null = null;

  if (settledAt) {
    let asleepSince: Date | null = settledAt;
    let wake: WakeEpisode | null = null;
    const closeWake = (end: Date) => {
      if (!wake) return;
      wake.end = end;
      const mins = (end.getTime() - wake.start.getTime()) / 60000;
      if (wake.cried || mins >= o.minWakeMinutes) wakes.push(wake);
      else briefStirs++;
      wake = null;
    };
    for (const e of evs) {
      if (e.at <= settledAt) continue;
      if (e.type === 'child_stirring' || isCryStart(e)) {
        if (asleepSince) {
          sleepMs += e.at.getTime() - asleepSince.getTime();
          asleepSince = null;
          wake = { start: e.at, end: null, cried: isCryStart(e) };
        } else if (wake && isCryStart(e)) {
          wake.cried = true;
        }
      } else if (e.type === 'child_settled' && !asleepSince) {
        closeWake(e.at);
        asleepSince = e.at;
      }
    }
    const endOfData = new Date(Math.min(winEnd.getTime(), o.now.getTime()));
    if (asleepSince) {
      sleepMs += Math.max(0, endOfData.getTime() - asleepSince.getTime());
    } else if (wake) {
      const open = wake as WakeEpisode;
      if (open.start.getHours() >= o.morningHour && open.start.getHours() < o.endHour + 2) {
        upAt = open.start;
      } else {
        wakes.push(open);
      }
    }
  }

  const sleepMinutes = Math.round(sleepMs / 60000);
  const summary: NightSummary = {
    date: localDateKey(winStart),
    settledAt,
    upAt,
    sleepMinutes,
    wakeUps: wakes,
    briefStirs,
    cryCount,
    cryMinutes: Math.round(crySeconds / 60),
    alerts,
    text: '',
  };
  summary.text = describeNight(summary);
  return summary;
}

export function describeNight(s: NightSummary): string {
  if (!s.settledAt) {
    return s.cryCount > 0
      ? `No settled sleep was recorded. Crying was detected ${s.cryCount} time${s.cryCount > 1 ? 's' : ''}.`
      : 'No settled sleep was recorded.';
  }
  const parts: string[] = [`Settled at ${formatClock(s.settledAt)}.`];
  if (s.wakeUps.length === 0) parts.push('Slept through with no wake-ups.');
  else {
    const list = s.wakeUps.map((w) => `${formatClock(w.start)}${w.cried ? ', cried' : ''}`).join('; ');
    parts.push(`Woke ${s.wakeUps.length} time${s.wakeUps.length > 1 ? 's' : ''} (${list}).`);
  }
  if (s.upAt) parts.push(`Up for the day at ${formatClock(s.upAt)}.`);
  parts.push(`About ${formatMinutes(s.sleepMinutes)} asleep.`);
  if (s.cryCount > 0) {
    parts.push(`Cried ${s.cryCount} time${s.cryCount > 1 ? 's' : ''}${s.cryMinutes > 0 ? `, ${formatMinutes(s.cryMinutes)} in total` : ''}.`);
  }
  const alertBits = Object.entries(s.alerts).map(([k, n]) => `${ALERT_LABELS[k]} ×${n}`);
  if (alertBits.length) parts.push(`Alerts: ${alertBits.join(', ')}.`);
  return parts.join(' ');
}
