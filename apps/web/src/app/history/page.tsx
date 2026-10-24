'use client';

import { EVENT_META, type EventType } from '@lulu/core';
import { useMemo, useState } from 'react';

import { EventTable } from '@/components/EventTable';
import { Card } from '@/components/ui';
import { useCameras, useEvents, useLulu } from '@/lib/lulu';

type Group = 'all' | 'sound' | 'safety' | 'sleep' | 'camera';

export default function History() {
  const { householdId } = useLulu();
  const [days, setDays] = useState(7);
  const [group, setGroup] = useState<Group>('all');
  const [alertsOnly, setAlertsOnly] = useState(true);
  const [camera, setCamera] = useState('all');
  const cameras = useCameras(householdId);
  const { events, reload } = useEvents(householdId, days);
  const names = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras]);

  const shown = events.filter(
    (e) =>
      (!alertsOnly || e.severity !== 'info') &&
      (group === 'all' || EVENT_META[e.type as EventType]?.group === group) &&
      (camera === 'all' || e.camera_id === camera),
  );

  const select = 'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm';
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">History</h1>
      <div className="flex flex-wrap items-center gap-3">
        <select className={select} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time range">
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
        <select className={select} value={group} onChange={(e) => setGroup(e.target.value as Group)} aria-label="Kind">
          <option value="all">All kinds</option>
          <option value="sound">Crying</option>
          <option value="safety">Safety</option>
          <option value="sleep">Sleep</option>
          <option value="camera">Camera</option>
        </select>
        {cameras.length > 1 && (
          <select className={select} value={camera} onChange={(e) => setCamera(e.target.value)} aria-label="Camera">
            <option value="all">All cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} />
          Alerts and warnings only
        </label>
        <span className="tabular ml-auto text-sm text-muted">{shown.length} events</span>
      </div>
      <Card>
        <EventTable events={shown} cameraNames={names} onChange={reload} />
      </Card>
    </div>
  );
}
