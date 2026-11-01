// Sends Expo push notifications. Called by the database with a shared secret:
//   { event_id }                     new warning/alert, to members whose preference includes it
//   { event_id, escalation: n }      unacknowledged alert, re-sent to every member
//   { event_id, acknowledged: true } someone took an escalated alert; tell everyone else
//   { summary: { household_id, user_id, timezone } }  morning sleep summary for one member
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { summarizeNight } from '../../../packages/core/src/sleep.ts';

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

interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high' | 'normal';
  channelId: 'alerts' | 'warnings' | 'summary';
  categoryId?: string;
  data: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-lulu-secret') !== Deno.env.get('LULU_NOTIFY_SECRET')) {
    return new Response('unauthorized', { status: 401 });
  }
  const body = await req.json();
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (body.summary) return Response.json({ sent: await sendSummary(supabase, body.summary) });

  const { data: event, error } = await supabase
    .from('events')
    .select('id, household_id, camera_id, type, severity, message, created_at, acknowledged_at, acknowledged_by, cameras(name)')
    .eq('id', body.event_id)
    .single();
  if (error || !event) return new Response('event not found', { status: 404 });

  const { data: members } = await supabase
    .from('household_members')
    .select('user_id, display_name, min_push_severity')
    .eq('household_id', event.household_id);
  const cameraName = (event.cameras as unknown as { name: string } | null)?.name ?? 'Lulu';
  const title = TITLES[event.type] ?? 'Update';
  const data = { eventId: event.id, cameraId: event.camera_id };

  let userIds: string[];
  let msg: Omit<PushMessage, 'to'>;
  if (body.acknowledged) {
    const who = (members ?? []).find((m) => m.user_id === event.acknowledged_by)?.display_name || 'Someone';
    userIds = (members ?? []).map((m) => m.user_id).filter((id) => id !== event.acknowledged_by);
    msg = { title: `${cameraName}: ${who} is on it`, body: `${who} responded to “${event.message}”.`, sound: 'default', priority: 'high', channelId: 'warnings', data };
  } else if (body.escalation) {
    // Raced with an acknowledgement: nothing to do.
    if (event.acknowledged_at) return Response.json({ sent: 0 });
    const mins = Math.max(1, Math.round((Date.now() - new Date(event.created_at).getTime()) / 60000));
    userIds = (members ?? []).map((m) => m.user_id);
    msg = {
      title: `⚠️ ${cameraName}: ${title}, no one has responded`,
      body: `${event.message} (${mins} min ago). Tap “I've got it” if you're handling it.`,
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
      categoryId: 'event',
      data,
    };
  } else {
    userIds = (members ?? []).filter((m) => RANK[event.severity] >= RANK[m.min_push_severity]).map((m) => m.user_id);
    msg = {
      title: `${cameraName}: ${title}`,
      body: event.message,
      sound: 'default',
      priority: 'high',
      channelId: event.severity === 'alert' ? 'alerts' : 'warnings',
      categoryId: 'event',
      data,
    };
  }
  return Response.json({ sent: await sendTo(supabase, userIds, msg) });
});

async function sendSummary(supabase: SupabaseClient, s: { household_id: string; user_id: string; timezone: string }): Promise<number> {
  const since = new Date(Date.now() - 30 * 3600_000).toISOString();
  const [{ data: events }, { data: household }] = await Promise.all([
    supabase.from('events').select('type, occurred_at, data').eq('household_id', s.household_id).gte('occurred_at', since),
    supabase.from('households').select('name').eq('id', s.household_id).single(),
  ]);
  // summarizeNight reads local clock fields. The Edge runtime runs in UTC, so shift every
  // timestamp to the member's wall-clock time expressed as UTC.
  const nowWall = wallClock(new Date(), s.timezone);
  const evening = new Date(nowWall.getTime() - 86400_000);
  const night = summarizeNight(
    (events ?? []).map((e) => ({ type: e.type, occurredAt: wallClock(new Date(e.occurred_at), s.timezone), data: e.data })),
    evening,
    { now: nowWall },
  );
  if (!night.settledAt && night.cryCount === 0) return 0;
  return sendTo(supabase, [s.user_id], {
    title: `${household?.name ?? 'Lulu'}: last night`,
    body: night.text,
    sound: 'default',
    priority: 'normal',
    channelId: 'summary',
    data: { kind: 'summary', householdId: s.household_id },
  });
}

function wallClock(d: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));
}

async function sendTo(supabase: SupabaseClient, userIds: string[], msg: Omit<PushMessage, 'to'>): Promise<number> {
  if (!userIds.length) return 0;
  const { data: tokens } = await supabase.from('push_tokens').select('token').in('user_id', userIds);
  const messages: PushMessage[] = (tokens ?? []).map(({ token }) => ({ to: token, ...msg }));

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
  return sent;
}
