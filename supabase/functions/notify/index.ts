// Sends Expo push notifications for a new warning/alert event to every household member
// whose notification preference includes that severity. Called by the events_notify trigger.
import { createClient } from 'npm:@supabase/supabase-js@2';

const RANK: Record<string, number> = { info: 0, warning: 1, alert: 2 };
const TITLES: Record<string, string> = {
  cry_detected: 'Crying',
  zone_edge: 'Near the edge',
  zone_exit: 'Left the safe zone',
  sat_up: 'Sat up',
  rolled_over: 'Rolled over',
  hazard_near: 'Object nearby',
  camera_blocked: 'Camera blocked',
  camera_dark: 'Too dark',
  camera_moved: 'Camera moved',
  camera_offline: 'Camera offline',
  battery_low: 'Battery low',
};

Deno.serve(async (req) => {
  if (req.headers.get('x-lulu-secret') !== Deno.env.get('LULU_NOTIFY_SECRET')) {
    return new Response('unauthorized', { status: 401 });
  }
  const { event_id } = await req.json();
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: event, error } = await supabase
    .from('events')
    .select('id, household_id, camera_id, type, severity, message, cameras(name)')
    .eq('id', event_id)
    .single();
  if (error || !event) return new Response('event not found', { status: 404 });

  const { data: members } = await supabase
    .from('household_members')
    .select('user_id, min_push_severity')
    .eq('household_id', event.household_id);
  const userIds = (members ?? [])
    .filter((m) => RANK[event.severity] >= RANK[m.min_push_severity])
    .map((m) => m.user_id);
  if (!userIds.length) return Response.json({ sent: 0 });

  const { data: tokens } = await supabase.from('push_tokens').select('token').in('user_id', userIds);
  const cameraName = (event.cameras as unknown as { name: string } | null)?.name ?? 'Lulu';
  const messages = (tokens ?? []).map(({ token }) => ({
    to: token,
    title: `${cameraName}: ${TITLES[event.type] ?? 'Update'}`,
    body: event.message,
    sound: 'default',
    priority: 'high',
    channelId: event.severity === 'alert' ? 'alerts' : 'warnings',
    data: { eventId: event.id, cameraId: event.camera_id },
  }));

  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(batch),
    });
    const body = await res.json().catch(() => ({}));
    const tickets: { status: string; details?: { error?: string } }[] = body.data ?? [];
    const dead = tickets.flatMap((t, j) => (t.details?.error === 'DeviceNotRegistered' ? [batch[j].to] : []));
    if (dead.length) await supabase.from('push_tokens').delete().in('token', dead);
    sent += tickets.filter((t) => t.status === 'ok').length;
  }
  return Response.json({ sent });
});
