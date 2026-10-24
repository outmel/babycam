import { summarizeNight } from '@lulu/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { EventItem } from '@/components/EventItem';
import { Banner, Button, Card, Pill, Row, Screen, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { timeAgo, useCameras, useEvents } from '@/lib/hooks';
import { registerForPush } from '@/lib/push';
import { useSession } from '@/lib/session';

export default function ParentHome() {
  const t = useTheme();
  const { householdId, membership } = useSession();
  const { cameras } = useCameras(householdId);
  const { events } = useEvents(householdId, { limit: 300 });
  const [pushIssue, setPushIssue] = useState<string | null>(null);

  useEffect(() => {
    registerForPush().then((r) => setPushIssue(r.ok ? null : r.reason));
  }, []);

  const names = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras]);
  const alerts = events.filter((e) => e.severity !== 'info').slice(0, 8);
  const lastNight = useMemo(() => {
    const now = new Date();
    const evening = new Date(now);
    if (now.getHours() < 18) evening.setDate(evening.getDate() - 1);
    return summarizeNight(events.map((e) => ({ type: e.type, occurredAt: e.occurred_at, data: e.data })), evening);
  }, [events]);
  const canWatch = membership?.role !== 'viewer';

  return (
    <Screen>
      {pushIssue && <Banner tone="warning" text={`Push alerts are off: ${pushIssue}`} />}
      {cameras.length === 0 && (
        <Card>
          <T variant="heading">No cameras yet</T>
          <T variant="muted">On a spare phone, sign in to Lulu with this family and choose Camera.</T>
        </Card>
      )}
      {cameras.map((c) => {
        const paused = c.status.analysis === 'paused_live';
        return (
          <Card key={c.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="heading">{c.name}</T>
              <Pill label={!c.online ? 'Offline' : paused ? 'Live view' : 'Watching'} color={!c.online ? t.alert : paused ? t.info : t.ok} />
            </Row>
            <T variant="small">
              {c.online ? 'Updated' : 'Last seen'} {timeAgo(c.last_seen_at)}
              {c.status.battery !== undefined ? ` · battery ${Math.round(c.status.battery * 100)}%${c.status.charging ? ' ⚡' : ''}` : ''}
              {c.zones.length === 0 ? ' · no safe zone yet' : ''}
            </T>
            {canWatch && <Button title="Open live view" onPress={() => router.push({ pathname: '/parent/live/[id]', params: { id: c.id } })} disabled={!c.online} />}
          </Card>
        );
      })}

      <Card>
        <T variant="label">Last night</T>
        <T>{lastNight.text}</T>
      </Card>

      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label">Recent alerts</T>
        <Button title="All history" variant="ghost" onPress={() => router.push('/parent/events')} />
      </Row>
      {alerts.length === 0 ? <T variant="muted">No alerts. All quiet.</T> : alerts.map((e) => <EventItem key={e.id} event={e} cameraName={e.camera_id ? names[e.camera_id] : undefined} />)}

      <Row>
        <Button title="Family" variant="secondary" onPress={() => router.push('/family')} style={{ flex: 1 }} />
        <Button title="Settings" variant="secondary" onPress={() => router.push('/settings')} style={{ flex: 1 }} />
      </Row>
      <T variant="small">Lulu is an awareness tool, not a medical device. It does not monitor breathing or prevent SIDS, and it doesn't replace direct supervision.</T>
    </Screen>
  );
}
