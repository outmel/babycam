import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL("../migrations/20261024000000_lulu_init.sql", import.meta.url), "utf8").replace(/^create extension.*$/gim, '-- (extension stubbed)');
const db = new PGlite();

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema extensions;
  create schema net; create table net.calls (url text, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ insert into net.calls values (url, body); select 1::bigint $$;
  create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
  create schema realtime; create table realtime.messages (id serial primary key, topic text, extension text, payload jsonb);
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
  create publication supabase_realtime;
`);
await db.exec(migration);
await db.exec(`
  grant usage on schema public, auth, realtime to authenticated;
  grant select, insert, delete on all tables in schema public to authenticated;
  grant update on public.households, public.cameras, public.events, public.push_tokens to authenticated;
  grant select, insert on realtime.messages to authenticated;
  grant all on all sequences in schema realtime to authenticated;
  grant execute on all functions in schema public to authenticated;
  revoke execute on function public.mark_offline_cameras() from authenticated;
  grant usage on schema net to authenticated; grant insert on net.calls to authenticated;
  grant usage on schema vault to authenticated; grant select on vault.decrypted_secrets to authenticated;
`);

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
await db.exec(`insert into auth.users values ('${A}'), ('${B}'), ('${C}')`);

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};
async function as(user, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role authenticated;`);
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec('reset role');
  }
}

const hid = (await as(A, `select public.create_household('Garcias', 'Sam') as id`)).rows[0].id;
check('owner creates household', !!hid);
const code = (await as(A, `select public.create_invite($1, 'caregiver') as c`, [hid])).rows[0].c;
check('owner creates invite', /^[A-Z2-9]{8}$/.test(code), code);
check('caregiver invite rejected for non-owner', !!(await as(C, `select public.create_invite($1, 'viewer')`, [hid])).error);

const cam = (await as(A, `insert into public.cameras (household_id, name) values ($1, 'Nursery') returning id`, [hid])).rows[0].id;
check('owner adds camera', !!cam);
check('heartbeat works', !(await as(A, `select public.camera_heartbeat($1, '{"battery":0.8}')`, [cam])).error);

const ev = await as(A, `insert into public.events (household_id, camera_id, type, severity, message, occurred_at, client_id) values ($1, $2, 'cry_detected', 'alert', 'Crying detected', now(), 'c1') returning id`, [hid, cam]);
check('camera writes event', !ev.error, ev.error);
const dup = await as(A, `insert into public.events (household_id, camera_id, type, severity, message, occurred_at, client_id) values ($1, $2, 'cry_detected', 'alert', 'x', now(), 'c1') on conflict (client_id) do nothing returning id`, [hid, cam]);
check('offline-queue retry is idempotent', !dup.error && dup.rows.length === 0, dup.error);

check('outsider sees no events', (await as(C, `select * from public.events`)).rows.length === 0);
check('outsider cannot write events', !!(await as(C, `insert into public.events (household_id, type, severity, message, occurred_at) values ($1, 'x', 'info', 'x', now())`, [hid])).error);
check('outsider cannot see household', (await as(C, `select * from public.households`)).rows.length === 0);

check('bad invite code rejected', !!(await as(B, `select public.redeem_invite('NOPE1234', 'Gran')`)).error);
const joined = await as(B, `select public.redeem_invite($1, 'Gran') as h`, [code.toLowerCase()]);
check('invite redeemed (case-insensitive)', joined.rows?.[0]?.h === hid, joined.error);
check('invite cannot be reused', !!(await as(C, `select public.redeem_invite($1, 'x')`, [code])).error);
check('caregiver sees events', (await as(B, `select * from public.events`)).rows.length === 1);
const selfPromote = await as(B, `update public.household_members set role = 'owner' where user_id = $1`, [B]);
check('caregiver cannot promote self', !!selfPromote.error, selfPromote.error?.slice(0, 60));
const pref = await as(B, `update public.household_members set min_push_severity = 'alert' where user_id = $1 returning *`, [B]);
check('caregiver can change own notification pref', pref.rows?.length === 1, pref.error);
check('caregiver cannot change roles via rpc', !!(await as(B, `select public.set_member_role($1, $2, 'viewer')`, [hid, A])).error);
check('last owner cannot be demoted', !!(await as(A, `select public.set_member_role($1, $2, 'viewer')`, [hid, A])).error);

const ack = await as(B, `select public.acknowledge_event(id) from public.events limit 1`);
check('caregiver acknowledges', !ack.error, ack.error);
check('ack recorded', (await as(A, `select acknowledged_by from public.events`)).rows[0].acknowledged_by === B);

// Live channel authorization
await db.exec(`select set_config('realtime.topic', 'live:${cam}', false)`);
check('caregiver can join live channel', (await as(B, `select public.can_live(realtime.topic()) as ok`)).rows[0].ok === true);
check('outsider cannot join live channel', (await as(C, `select public.can_live(realtime.topic()) as ok`)).rows[0].ok === false);
await db.exec(`select set_config('realtime.topic', 'live:not-a-uuid', false)`);
check('malformed topic rejected safely', (await as(B, `select public.can_live(realtime.topic()) as ok`)).rows[0].ok === false);
await db.exec(`select set_config('realtime.topic', 'live:${cam}', false)`);
await as(A, `select public.set_member_role($1, $2, 'viewer')`, [hid, B]);
check('viewer cannot join live channel', (await as(B, `select public.can_live(realtime.topic()) as ok`)).rows[0].ok === false);
check('viewer cannot write events', !!(await as(B, `insert into public.events (household_id, type, severity, message, occurred_at) values ($1, 'x', 'info', 'x', now())`, [hid])).error);
check('viewer cannot call heartbeat', !!(await as(B, `select public.camera_heartbeat($1, '{}')`, [cam])).error);

// Offline detection + online recovery
await db.exec(`update public.cameras set last_seen_at = now() - interval '5 minutes'`);
check('mark_offline not callable by users', !!(await as(A, `select public.mark_offline_cameras()`)).error);
await db.exec(`select public.mark_offline_cameras()`);
const off = await db.query(`select type, severity from public.events where type = 'camera_offline'`);
check('offline camera raises alert', off.rows.length === 1 && off.rows[0].severity === 'alert');
await db.exec(`select public.mark_offline_cameras()`);
check('offline alert not repeated', (await db.query(`select 1 from public.events where type = 'camera_offline'`)).rows.length === 1);
await as(A, `select public.camera_heartbeat($1, '{}')`, [cam]);
check('heartbeat after outage logs camera_online', (await db.query(`select 1 from public.events where type = 'camera_online'`)).rows.length === 1);

// Push trigger
check('no push call without vault secrets', (await db.query(`select * from net.calls`)).rows.length === 0);
await db.exec(`insert into vault.decrypted_secrets values ('lulu_project_url', 'https://x.supabase.co'), ('lulu_notify_secret', 's3cret')`);
await as(A, `insert into public.events (household_id, type, severity, message, occurred_at) values ($1, 'zone_exit', 'alert', 'left', now())`, [hid]);
await as(A, `insert into public.events (household_id, type, severity, message, occurred_at) values ($1, 'child_settled', 'info', 'settled', now())`, [hid]);
const calls = (await db.query(`select * from net.calls`)).rows;
check('alert triggers push, info does not', calls.length === 1 && calls[0].url.endsWith('/functions/v1/notify'));

console.log(failures ? `\n${failures} FAILED` : '\nAll SQL checks passed');
process.exit(failures ? 1 : 0);
