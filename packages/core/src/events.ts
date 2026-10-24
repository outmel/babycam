/** Display metadata shared by the mobile app, the web dashboard and the push function. */
import type { EventType, Severity } from './types';

export interface EventMeta {
  title: string;
  severity: Severity;
  /** Grouping used for filters and charts. */
  group: 'sound' | 'safety' | 'sleep' | 'camera';
}

export const EVENT_META: Record<EventType, EventMeta> = {
  cry_detected: { title: 'Crying', severity: 'alert', group: 'sound' },
  cry_stopped: { title: 'Crying stopped', severity: 'info', group: 'sound' },
  zone_edge: { title: 'Near zone edge', severity: 'warning', group: 'safety' },
  zone_exit: { title: 'Left safe zone', severity: 'alert', group: 'safety' },
  sat_up: { title: 'Sat up', severity: 'warning', group: 'safety' },
  rolled_over: { title: 'Rolled over', severity: 'alert', group: 'safety' },
  hazard_near: { title: 'Object nearby', severity: 'alert', group: 'safety' },
  child_stirring: { title: 'Stirring', severity: 'info', group: 'sleep' },
  child_settled: { title: 'Settled', severity: 'info', group: 'sleep' },
  camera_blocked: { title: 'Camera blocked', severity: 'alert', group: 'camera' },
  camera_dark: { title: 'Too dark', severity: 'warning', group: 'camera' },
  camera_moved: { title: 'Camera moved', severity: 'warning', group: 'camera' },
  camera_ok: { title: 'Camera clear', severity: 'info', group: 'camera' },
  camera_offline: { title: 'Camera offline', severity: 'alert', group: 'camera' },
  camera_online: { title: 'Camera back online', severity: 'info', group: 'camera' },
  battery_low: { title: 'Battery low', severity: 'warning', group: 'camera' },
  analysis_paused: { title: 'Alerts paused', severity: 'info', group: 'camera' },
  analysis_resumed: { title: 'Alerts resumed', severity: 'info', group: 'camera' },
};

export function eventTitle(type: string): string {
  return (EVENT_META as Record<string, EventMeta | undefined>)[type]?.title ?? type;
}

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, alert: 2 };
