import { Fragment, useMemo, useState } from 'react';

import { EventItem } from '@/components/EventItem';
import { Screen, Segmented, T } from '@/components/ui';
import { useCameras, useEvents } from '@/lib/hooks';
import { useSession } from '@/lib/session';

export default function History() {
  const { householdId } = useSession();
  const [filter, setFilter] = useState<'warning' | 'info'>('warning');
  const { events, loading } = useEvents(householdId, { limit: 200, minSeverity: filter });
  const { cameras } = useCameras(householdId);
  const names = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras]);

  // Group by local day.
  const days = useMemo(() => {
    const map = new Map<string, typeof events>();
    for (const e of events) {
      const key = new Date(e.occurred_at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()];
  }, [events]);

  return (
    <Screen>
      <Segmented value={filter} onChange={setFilter} options={[{ value: 'warning', label: 'Alerts' }, { value: 'info', label: 'Everything' }]} />
      {!loading && events.length === 0 && <T variant="muted">Nothing here yet.</T>}
      {days.map(([day, list]) => (
        <Fragment key={day}>
          <T variant="label">
            {day}
          </T>
          {list.map((e) => (
            <EventItem key={e.id} event={e} cameraName={e.camera_id ? names[e.camera_id] : undefined} />
          ))}
        </Fragment>
      ))}
    </Screen>
  );
}
