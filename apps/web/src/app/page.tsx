'use client';

import { EVENT_META, localDateKey, summarizeNight, type EventType } from '@lulu/core';
import { useMemo } from 'react';

import { AlertsByDay, type DayAlerts } from '@/components/Charts';
import { EventTable } from '@/components/EventTable';
import { Card, Label, Pill, Stat } from '@/components/ui';
import { timeAgo, useCameras, useEvents, useLulu } from '@/lib/lulu';

const DAYS = 14;

export default function Overview() {
  const { householdId } = useLulu();
  const cameras = useCameras(householdId);
  const { events, reload } = useEvents(householdId, DAYS);
  const names = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras]);

  const byDay = useMemo<DayAlerts[]>(() => {
    const rows = new Map<string, DayAlerts>();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      rows.set(localDateKey(d), { day: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), sound: 0, safety: 0, camera: 0 });
    }
    for (const e of events) {
      if (e.severity === 'info') continue;
      const row = rows.get(localDateKey(new Date(e.occurred_at)));
      const group = EVENT_META[e.type as EventType]?.group;
      if (!row || !group || group === 'sleep') continue;
      row[group] += 1;
    }
    return [...rows.values()];
  }, [events]);

  const last24 = events.filter((e) => e.severity !== 'info' && Date.now() - new Date(e.occurred_at).getTime() < 86400_000);
  const unseen = events.filter((e) => e.severity === 'alert' && !e.acknowledged_at).length;
  const night = useMemo(() => {
    const evening = new Date();
    if (evening.getHours() < 18) evening.setDate(evening.getDate() - 1);
    return summarizeNight(events.map((e) => ({ type: e.type, occurredAt: e.occurred_at, data: e.data })), evening);
  }, [events]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cameras.map((c) => (
          <Card key={c.id}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{c.name}</h2>
              <Pill tone={!c.online ? 'alert' : c.status.analysis === 'paused_live' ? 'info' : 'ok'}>
                {!c.online ? 'Offline' : c.status.analysis === 'paused_live' ? 'Live view' : 'Watching'}
              </Pill>
            </div>
            <p className="mt-2 text-sm text-muted">
              {c.online ? 'Updated' : 'Last seen'} {timeAgo(c.last_seen_at)}
              {c.status.battery !== undefined && ` · ${Math.round(c.status.battery * 100)}% battery${c.status.charging ? ', charging' : ''}`}
            </p>
            {c.zones.length === 0 && <p className="mt-1 text-sm text-warning">No safe zone drawn yet</p>}
          </Card>
        ))}
        {cameras.length === 0 && (
          <Card className="sm:col-span-2">
            <p className="text-muted">No cameras yet. Open Lulu on a spare phone and choose Camera.</p>
          </Card>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Alerts, last 24 h" value={last24.length} sub={unseen ? `${unseen} not marked seen` : 'All seen'} />
        <Stat label="Asleep last night" value={night.settledAt ? `${Math.floor(night.sleepMinutes / 60)}h ${night.sleepMinutes % 60}m` : '—'} sub={`${night.wakeUps.length} wake-up${night.wakeUps.length === 1 ? '' : 's'}`} />
        <Stat label="Crying last night" value={night.cryCount} sub={night.cryMinutes ? `${night.cryMinutes} min in total` : 'No long episodes'} />
      </div>

      <Card>
        <Label>Last night</Label>
        <p className="mt-2 leading-relaxed">{night.text}</p>
      </Card>

      <Card>
        <div className="mb-4">
          <Label>Alerts and warnings per day</Label>
          <p className="mt-1 text-sm text-muted">Last {DAYS} days, by kind</p>
        </div>
        <AlertsByDay data={byDay} />
      </Card>

      <Card>
        <Label>Recent alerts</Label>
        <div className="mt-3">
          <EventTable events={events.filter((e) => e.severity !== 'info').slice(0, 12)} cameraNames={names} onChange={reload} />
        </div>
      </Card>
    </div>
  );
}
