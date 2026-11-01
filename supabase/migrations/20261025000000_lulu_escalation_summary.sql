-- Escalating alerts, "on it" follow-ups and the morning sleep summary push.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- How many times an unacknowledged alert has been re-sent to the whole family.
alter table public.events
  add column escalations smallint not null default 0,
  add column last_escalated_at timestamptz;

-- Morning summary preference, the member's IANA time zone (set by their phone) and the
-- local date the last summary went out, so each morning sends at most once.
alter table public.household_members
  add column morning_summary boolean not null default true,
  add column timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  add column last_summary_on date;

grant update (display_name, min_push_severity, morning_summary, timezone) on public.household_members to authenticated;

-- ---------------------------------------------------------------------------
-- Calling the notify Edge Function
-- ---------------------------------------------------------------------------

create function public.call_notify(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  base_url text;
  secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'lulu_project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'lulu_notify_secret';
  if base_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := base_url || '/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-lulu-secret', secret),
    body := payload
  );
end;
$$;

create or replace function public.notify_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.call_notify(jsonb_build_object('event_id', new.id));
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Escalation: an urgent alert nobody has acknowledged is re-sent to everyone in the
-- family (ignoring their "urgent only" preference) every 2 minutes, up to 3 times.
-- It stops as soon as someone acknowledges it, the situation resolves (crying
-- stopped, camera back), or a newer alert of the same kind replaces it.
-- ---------------------------------------------------------------------------

create function public.escalate_alerts()
returns void language plpgsql security definer set search_path = '' as $$
declare
  ev record;
begin
  for ev in
    update public.events e set escalations = e.escalations + 1, last_escalated_at = now()
    where e.severity = 'alert'
      and e.acknowledged_at is null
      and e.escalations < 3
      and e.created_at > now() - interval '15 minutes'
      and coalesce(e.last_escalated_at, e.created_at) <= now() - interval '2 minutes'
      and coalesce(e.data ->> 'reminder', 'false') <> 'true'
      and not exists (
        select 1 from public.events later
        where later.household_id = e.household_id
          and later.camera_id is not distinct from e.camera_id
          and later.occurred_at > e.occurred_at
          and (
            later.type = e.type
            or (e.type = 'cry_detected' and later.type = 'cry_stopped')
            or (e.type = 'camera_offline' and later.type = 'camera_online')
            or (e.type in ('camera_blocked', 'camera_dark') and later.type = 'camera_ok')
          )
      )
    returning e.id, e.escalations
  loop
    perform public.call_notify(jsonb_build_object('event_id', ev.id, 'escalation', ev.escalations));
  end loop;
end;
$$;

-- Once an escalated alert is acknowledged, tell everyone else who's handling it.
create function public.notify_acknowledged()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.call_notify(jsonb_build_object('event_id', new.id, 'acknowledged', true));
  return new;
end;
$$;

create trigger events_ack_notify
  after update of acknowledged_at on public.events
  for each row when (old.acknowledged_at is null and new.acknowledged_at is not null and new.escalations > 0)
  execute function public.notify_acknowledged();

-- ---------------------------------------------------------------------------
-- Morning summary: run hourly. Each member who wants it gets one push between 7 and
-- 11 am in their own time zone, if their family's cameras recorded anything overnight.
-- ---------------------------------------------------------------------------

-- Wall-clock time in a member's zone, or null if the zone name isn't recognized, so one
-- bad value from a phone can't break the job for everyone.
create function public.local_now(tz text)
returns timestamp language plpgsql stable set search_path = '' as $$
begin
  return now() at time zone tz;
exception when others then
  return null;
end;
$$;

create function public.send_morning_summaries()
returns void language plpgsql security definer set search_path = '' as $$
declare
  m record;
begin
  for m in
    update public.household_members hm
    set last_summary_on = public.local_now(hm.timezone)::date
    where hm.morning_summary
      and extract(hour from public.local_now(hm.timezone)) between 7 and 10
      and (hm.last_summary_on is null or hm.last_summary_on < public.local_now(hm.timezone)::date)
      and exists (select 1 from public.push_tokens t where t.user_id = hm.user_id)
      and exists (
        select 1 from public.events e
        where e.household_id = hm.household_id
          and e.occurred_at > now() - interval '18 hours'
          and e.type in ('child_settled', 'child_stirring', 'cry_detected')
      )
    returning hm.household_id, hm.user_id, hm.timezone
  loop
    perform public.call_notify(jsonb_build_object(
      'summary', jsonb_build_object('household_id', m.household_id, 'user_id', m.user_id, 'timezone', m.timezone)
    ));
  end loop;
end;
$$;

revoke execute on function public.call_notify(jsonb) from public, anon, authenticated;
revoke execute on function public.escalate_alerts() from public, anon, authenticated;
revoke execute on function public.send_morning_summaries() from public, anon, authenticated;

select cron.schedule('lulu-escalate-alerts', '* * * * *', $$select public.escalate_alerts()$$);
select cron.schedule('lulu-morning-summaries', '0 * * * *', $$select public.send_morning_summaries()$$);
