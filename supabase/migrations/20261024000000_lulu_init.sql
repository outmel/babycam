-- Lulu schema: households, caregivers with roles, cameras, text-only events, push tokens.
-- No images, video or audio are ever stored. Events are short text rows.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create type public.member_role as enum ('owner', 'caregiver', 'viewer');
create type public.severity as enum ('info', 'warning', 'alert');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  display_name text not null default '' check (char_length(display_name) <= 60),
  -- Lowest severity this person gets push notifications for.
  min_push_severity public.severity not null default 'warning',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  code text not null unique,
  role public.member_role not null check (role <> 'owner'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz
);

create table public.cameras (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- Safe zones as normalized polygons: [{id, name, points: [{x, y}]}]
  zones jsonb not null default '[]'::jsonb,
  -- {mount: 'overhead'|'side', features: {...}}
  settings jsonb not null default '{}'::jsonb,
  -- Latest heartbeat payload: battery, charging, analysis state, model status.
  status jsonb not null default '{}'::jsonb,
  online boolean not null default false,
  last_seen_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index cameras_household_idx on public.cameras (household_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  camera_id uuid references public.cameras (id) on delete set null,
  -- Idempotency key from the camera's offline queue, so retries never duplicate rows.
  client_id text unique,
  type text not null check (char_length(type) <= 40),
  severity public.severity not null,
  message text not null check (char_length(message) <= 300),
  track text check (char_length(track) <= 8),
  data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users (id) on delete set null,
  acknowledged_at timestamptz
);
create index events_household_time_idx on public.events (household_id, occurred_at desc);
create index events_camera_time_idx on public.events (camera_id, occurred_at desc);

create table public.push_tokens (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer so policies don't recurse into RLS)
-- ---------------------------------------------------------------------------

create function public.is_member(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;

create function public.has_role(hid uuid, roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

-- Live view is limited to owners and caregivers of the camera's household.
create function public.can_live(topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select topic ~ '^live:[0-9a-f-]{36}$' and exists (
    select 1 from public.cameras c
    where c.id = substring(topic from 6)::uuid
      and public.has_role(c.household_id, array['owner', 'caregiver']::public.member_role[])
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.invites enable row level security;
alter table public.cameras enable row level security;
alter table public.events enable row level security;
alter table public.push_tokens enable row level security;

create policy "members read their households" on public.households
  for select to authenticated using (public.is_member(id));
create policy "owners rename households" on public.households
  for update to authenticated using (public.has_role(id, '{owner}')) with check (public.has_role(id, '{owner}'));
create policy "owners delete households" on public.households
  for delete to authenticated using (public.has_role(id, '{owner}'));

create policy "members see each other" on public.household_members
  for select to authenticated using (public.is_member(household_id));
-- Members edit only their own name and notification preference (column grants below).
-- Role changes go through set_member_role().
create policy "members edit own preferences" on public.household_members
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owners remove members, anyone can leave" on public.household_members
  for delete to authenticated using (user_id = (select auth.uid()) or public.has_role(household_id, '{owner}'));
revoke update on public.household_members from authenticated;
grant update (display_name, min_push_severity) on public.household_members to authenticated;

create policy "owners see invites" on public.invites
  for select to authenticated using (public.has_role(household_id, '{owner}'));
create policy "owners revoke invites" on public.invites
  for delete to authenticated using (public.has_role(household_id, '{owner}'));

create policy "members see cameras" on public.cameras
  for select to authenticated using (public.is_member(household_id));
create policy "caregivers add cameras" on public.cameras
  for insert to authenticated with check (public.has_role(household_id, '{owner,caregiver}'));
create policy "caregivers configure cameras" on public.cameras
  for update to authenticated using (public.has_role(household_id, '{owner,caregiver}'))
  with check (public.has_role(household_id, '{owner,caregiver}'));
create policy "owners remove cameras" on public.cameras
  for delete to authenticated using (public.has_role(household_id, '{owner}'));

create policy "members read events" on public.events
  for select to authenticated using (public.is_member(household_id));
create policy "camera phones write events" on public.events
  for insert to authenticated with check (
    public.has_role(household_id, '{owner,caregiver}')
    and (camera_id is null or exists (
      select 1 from public.cameras c where c.id = camera_id and c.household_id = events.household_id
    ))
  );
create policy "owners delete events" on public.events
  for delete to authenticated using (public.has_role(household_id, '{owner}'));

create policy "users manage own push tokens" on public.push_tokens
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create function public.create_household(p_name text, p_display_name text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.households (name, created_by) values (p_name, auth.uid()) returning id into hid;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (hid, auth.uid(), 'owner', coalesce(p_display_name, ''));
  return hid;
end;
$$;

create function public.create_invite(p_household uuid, p_role public.member_role default 'caregiver')
returns text language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  new_code text;
begin
  if not public.has_role(p_household, '{owner}') then raise exception 'only owners can invite'; end if;
  if p_role = 'owner' then raise exception 'invite as caregiver or viewer, then promote'; end if;
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
      into new_code from generate_series(1, 8);
    exit when not exists (select 1 from public.invites where code = new_code);
  end loop;
  insert into public.invites (household_id, code, role, created_by) values (p_household, new_code, p_role, auth.uid());
  return new_code;
end;
$$;

create function public.redeem_invite(p_code text, p_display_name text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  inv public.invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from public.invites
  where code = upper(trim(p_code)) and redeemed_at is null and expires_at > now()
  for update;
  if not found then raise exception 'invite code is invalid or has expired'; end if;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (inv.household_id, auth.uid(), inv.role, coalesce(p_display_name, ''))
  on conflict (household_id, user_id) do nothing;
  update public.invites set redeemed_by = auth.uid(), redeemed_at = now() where id = inv.id;
  return inv.household_id;
end;
$$;

create function public.set_member_role(p_household uuid, p_user uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_household, '{owner}') then raise exception 'only owners can change roles'; end if;
  if p_role <> 'owner' and (
    select count(*) from public.household_members where household_id = p_household and role = 'owner' and user_id <> p_user
  ) = 0 then
    raise exception 'a household needs at least one owner';
  end if;
  update public.household_members set role = p_role where household_id = p_household and user_id = p_user;
end;
$$;

-- Called by the camera phone every 30 s.
create function public.camera_heartbeat(p_camera uuid, p_status jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cam public.cameras;
begin
  select * into cam from public.cameras where id = p_camera for update;
  if not found or not public.has_role(cam.household_id, '{owner,caregiver}') then
    raise exception 'camera not found';
  end if;
  update public.cameras set online = true, last_seen_at = now(), status = coalesce(p_status, '{}'::jsonb) where id = p_camera;
  if not cam.online and cam.last_seen_at is not null then
    insert into public.events (household_id, camera_id, type, severity, message, occurred_at)
    values (cam.household_id, cam.id, 'camera_online', 'info', cam.name || ' is back online', now());
  end if;
end;
$$;

create function public.acknowledge_event(p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.events set acknowledged_by = auth.uid(), acknowledged_at = now()
  where id = p_event and acknowledged_at is null and public.is_member(household_id);
end;
$$;

-- Run every minute by pg_cron: a camera that stops sending heartbeats raises an alert,
-- so a dead battery or crashed app is never mistaken for a quiet night.
create function public.mark_offline_cameras()
returns void language plpgsql security definer set search_path = '' as $$
declare
  cam record;
begin
  for cam in
    update public.cameras set online = false
    where online and last_seen_at < now() - interval '2 minutes'
    returning id, household_id, name, status
  loop
    insert into public.events (household_id, camera_id, type, severity, message, occurred_at)
    values (cam.household_id, cam.id, 'camera_offline', 'alert',
            cam.name || ' stopped responding. Check its power and Wi-Fi.', now());
  end loop;
end;
$$;

revoke execute on function public.mark_offline_cameras() from public, anon, authenticated;
revoke execute on function public.can_live(text) from anon;

select cron.schedule('lulu-mark-offline-cameras', '* * * * *', $$select public.mark_offline_cameras()$$);

-- ---------------------------------------------------------------------------
-- Push notifications: warnings and alerts call the `notify` Edge Function.
-- Set the two Vault secrets after deploying (see README):
--   select vault.create_secret('https://<project>.supabase.co', 'lulu_project_url');
--   select vault.create_secret('<random string>', 'lulu_notify_secret');
-- ---------------------------------------------------------------------------

create function public.notify_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  base_url text;
  secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'lulu_project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'lulu_notify_secret';
  if base_url is null or secret is null then
    return new;
  end if;
  perform net.http_post(
    url := base_url || '/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-lulu-secret', secret),
    body := jsonb_build_object('event_id', new.id)
  );
  return new;
end;
$$;

create trigger events_notify
  after insert on public.events
  for each row when (new.severity in ('warning', 'alert'))
  execute function public.notify_event();

-- ---------------------------------------------------------------------------
-- Realtime: event feed + camera status for parents, private live-view signaling channels.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.events, public.cameras;

create policy "caregivers join live channels" on realtime.messages
  for select to authenticated using (public.can_live((select realtime.topic())));
create policy "caregivers signal on live channels" on realtime.messages
  for insert to authenticated with check (public.can_live((select realtime.topic())));
