-- 0007: live dashboard (collector 1.2.0).
--   * Every server pushes a small live snapshot every 5 seconds straight to PostgREST (public.sm_live),
--     authenticated by the report token (only its sha256 is stored here). n8n is not involved.
--   * Refresh reports (full checks every 15 minutes or on "Re-check now") go to public.sm_push_report;
--     only the newest refresh report per server is kept. The daily report still goes through n8n.
--   * The daily email keeps comparing with the previous DAILY report (issue_history).
-- Additive: columns, two tables, new functions; redefines issue_history, sm_fleet, sm_server, sm_reports.
-- No data change. Safe to run twice.
--
-- After applying, store the hash of the report token once (as postgres, the token is never typed):
--   select server_manager.set_live_key('<sha256 hex of the report token>');
--
-- Rollback:
--   drop function if exists public.sm_live(text, jsonb);
--   drop function if exists public.sm_push_report(text, jsonb);
--   drop function if exists public.sm_recheck(text);
--   drop function if exists public.sm_live_fleet();
--   drop function if exists public.sm_live_server(text);
--   drop function if exists server_manager.set_live_key(text);
--   drop function if exists server_manager.live_auth(text);
--   drop table if exists server_manager.live_points;
--   drop table if exists server_manager.settings;
--   alter table server_manager.servers drop column if exists live, drop column if exists live_at,
--     drop column if exists recheck_requested_at;
--   delete from server_manager.reports where type = 'refresh';
--   then re-run 0003 (issue_history), 0005 (sm_reports) and the sm_fleet / sm_server part of 0006.

begin;

alter table server_manager.servers add column if not exists live                 jsonb;
alter table server_manager.servers add column if not exists live_at              timestamptz;
alter table server_manager.servers add column if not exists recheck_requested_at timestamptz;

create table if not exists server_manager.settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- one point per server per minute, kept 48 hours (hub charts)
create table if not exists server_manager.live_points (
  hostname  text not null references server_manager.servers (hostname) on update cascade on delete cascade,
  at        timestamptz not null,
  cpu       real,
  ram       real,
  disk      real,
  swap_mb   int,
  load1     real,
  running   int,
  total     int,
  primary key (hostname, at)
);

alter table server_manager.settings    enable row level security;
alter table server_manager.live_points enable row level security;
revoke all on server_manager.settings, server_manager.live_points from public, anon, authenticated;
grant select, insert, update, delete on server_manager.live_points to service_role;

-- set by hand as postgres; nobody else can call it
create or replace function server_manager.set_live_key(p_sha256 text)
returns void
language plpgsql
security definer
set search_path = server_manager, pg_temp
as $$
begin
  if p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'expected a sha256 hex digest (64 lowercase hex characters)';
  end if;
  insert into settings (key, value, updated_at) values ('live_key_sha256', p_sha256, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;
revoke all on function server_manager.set_live_key(text) from public, anon, authenticated, service_role;

create or replace function server_manager.live_auth(p_token text)
returns boolean
language sql
stable
security definer
set search_path = server_manager, pg_temp
as $$
  select coalesce(length(p_token) >= 16, false) and exists (
    select 1 from settings
    where key = 'live_key_sha256' and value = encode(sha256(convert_to(p_token, 'UTF8')), 'hex'));
$$;
revoke all on function server_manager.live_auth(text) from public, anon, authenticated;

-- live snapshot from the collector, every 5 seconds. Known servers only. Returns whether a re-check was asked.
create or replace function public.sm_live(p_token text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = server_manager, pg_temp
as $$
declare
  v_host    text := p ->> 'hostname';
  v_now     timestamptz := now();
  v_recheck timestamptz;
  v_live    jsonb;
begin
  if not live_auth(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_host is null or v_host = '' or octet_length(p::text) > 65536 then
    raise exception 'invalid live snapshot' using errcode = '22023';
  end if;

  -- keep only the fields the hub uses
  v_live := jsonb_strip_nulls(jsonb_build_object(
    'collector', p ->> 'collector', 'cpu', p -> 'cpu', 'ram', p -> 'ram', 'ram_mb', p -> 'ram_mb',
    'ram_total_mb', p -> 'ram_total_mb', 'swap_mb', p -> 'swap_mb', 'disk', p -> 'disk', 'disk_gb', p -> 'disk_gb',
    'disk_total_gb', p -> 'disk_total_gb', 'load1', p -> 'load1', 'cores', p -> 'cores', 'boot_at', p -> 'boot_at',
    'running', p -> 'running', 'total', p -> 'total', 'containers', p -> 'containers'));

  update servers set
    live = v_live,
    live_at = v_now,
    last_heartbeat_at = greatest(last_heartbeat_at, v_now)
  where hostname = v_host and not archived
  returning recheck_requested_at into v_recheck;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown server: send a report first');
  end if;
  if v_recheck is not null then
    update servers set recheck_requested_at = null where hostname = v_host;
  end if;

  if not exists (select 1 from live_points where hostname = v_host and at > v_now - interval '55 seconds') then
    insert into live_points (hostname, at, cpu, ram, disk, swap_mb, load1, running, total)
    values (v_host, v_now, (p ->> 'cpu')::real, (p ->> 'ram')::real, (p ->> 'disk')::real, (p ->> 'swap_mb')::int,
            (p ->> 'load1')::real, (p ->> 'running')::int, (p ->> 'total')::int)
    on conflict do nothing;
    delete from live_points where hostname = v_host and at < v_now - interval '48 hours';
  end if;

  return jsonb_build_object('ok', true, 'recheck', v_recheck is not null);
end;
$$;

-- refresh report (full checks, no email). Only the newest refresh report per server is kept.
create or replace function public.sm_push_report(p_token text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = server_manager, pg_temp
as $$
declare
  v_host text := p #>> '{server,hostname}';
  v_id   text := p #>> '{report,id}';
  v_res  jsonb;
begin
  if not live_auth(p_token) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p #>> '{report,type}' is distinct from 'refresh' then
    raise exception 'only refresh reports are accepted here; daily reports go through n8n' using errcode = '22023';
  end if;
  if not exists (select 1 from servers where hostname = v_host and not archived) then
    return jsonb_build_object('stored', false, 'reason', 'unknown server: send a daily report first');
  end if;
  v_res := ingest_report(p);
  delete from reports where hostname = v_host and type = 'refresh' and id <> v_id;
  return v_res - 'history';
end;
$$;

-- hub: ask the collector for a refresh report (picked up by the next live push, within seconds)
create or replace function public.sm_recheck(p_hostname text)
returns jsonb
language sql
security definer
set search_path = server_manager, pg_temp
as $$
  update servers set recheck_requested_at = now() where hostname = p_hostname and not archived
  returning jsonb_build_object('hostname', hostname, 'requested_at', recheck_requested_at);
$$;

-- hub polling: small, every 5 seconds
create or replace function public.sm_live_fleet()
returns jsonb
language sql
stable
security definer
set search_path = server_manager, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'hostname', s.hostname, 'live', s.live - 'containers', 'live_at', s.live_at,
           'last_heartbeat_at', s.last_heartbeat_at, 'last_report_at', s.last_report_at,
           'recheck_requested_at', s.recheck_requested_at
         ) order by s.hostname), '[]'::jsonb)
  from servers s where not s.archived;
$$;

create or replace function public.sm_live_server(p_hostname text)
returns jsonb
language sql
stable
security definer
set search_path = server_manager, pg_temp
as $$
  select jsonb_build_object(
           'hostname', s.hostname, 'live', s.live, 'live_at', s.live_at,
           'last_heartbeat_at', s.last_heartbeat_at, 'last_report_at', s.last_report_at,
           'last_report_id', s.last_report_id, 'recheck_requested_at', s.recheck_requested_at,
           -- 24 h in 5-minute buckets, oldest first
           'points', coalesce((
             select jsonb_agg(jsonb_build_object('at', b.at, 'cpu', b.cpu, 'ram', b.ram, 'disk', b.disk) order by b.at)
             from (
               select to_timestamp(floor(extract(epoch from at) / 300) * 300) as at,
                      round(avg(cpu)::numeric, 1) as cpu, round(avg(ram)::numeric, 1) as ram, round(avg(disk)::numeric, 1) as disk
               from live_points
               where hostname = s.hostname and at > now() - interval '24 hours'
               group by 1
             ) b), '[]'::jsonb))
  from servers s
  where s.hostname = p_hostname and not s.archived;
$$;

-- daily email: compare with the previous DAILY report (refresh reports move issue state in between)
create or replace function server_manager.issue_history(p_host text)
returns jsonb
language sql
stable
security definer
set search_path = server_manager, pg_temp
as $$
  with d as (
    select generated_at from reports where hostname = p_host and type <> 'refresh'
  ), latest as (
    select max(generated_at) as at, count(*) as n from d
  ), prev as (
    select max(generated_at) as at from d where generated_at < (select at from latest)
  )
  select jsonb_build_object(
    'reports', (select n from latest),
    'latest_report_at', (select at from latest),
    'previous_report_at', (select at from prev),
    'open', coalesce((select jsonb_agg(jsonb_build_object(
                'key', i.fingerprint, 'check_id', i.check_id, 'title', i.title, 'severity', i.severity,
                'first_seen_at', i.first_seen_at,
                'new', (select at from prev) is null or i.first_seen_at > (select at from prev))
              order by i.first_seen_at desc)
              from issues i where i.hostname = p_host and i.resolved_at is null), '[]'::jsonb),
    'resolved', coalesce((select jsonb_agg(jsonb_build_object(
                'key', i.fingerprint, 'check_id', i.check_id, 'title', i.title, 'severity', i.severity,
                'first_seen_at', i.first_seen_at, 'resolved_at', i.resolved_at))
              from issues i
              where i.hostname = p_host and i.resolved_at is not null
                and case when (select at from prev) is null
                         then i.resolved_at = (select at from latest)
                         else i.resolved_at > (select at from prev) and i.resolved_at <= (select at from latest)
                              and i.first_seen_at <= (select at from prev) end), '[]'::jsonb)
  );
$$;

-- Daily reports page: refresh reports are not listed
create or replace function public.sm_reports(p_limit int default 200, p_hostname text default null)
returns jsonb
language sql
stable
security definer
set search_path = server_manager, pg_temp
as $$
  select coalesce(jsonb_agg(x order by x.generated_at desc), '[]'::jsonb)
  from (
    select r.id, r.hostname, s.client, s.env, r.type, r.generated_at, r.status, r.received_at,
           (select count(*) from jsonb_array_elements(coalesce(r.payload -> 'attention', '[]'::jsonb)) a where a ->> 'severity' = 'critical') as critical,
           (select count(*) from jsonb_array_elements(coalesce(r.payload -> 'attention', '[]'::jsonb)) a where a ->> 'severity' = 'warning') as warning
    from reports r join servers s on s.hostname = r.hostname
    where (p_hostname is null or r.hostname = p_hostname) and r.type <> 'refresh'
    order by r.generated_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  ) x;
$$;

-- hub read API: as 0006 plus live / live_at
create or replace function public.sm_fleet()
returns jsonb
language sql
stable
security definer
set search_path = server_manager, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'hostname', s.hostname, 'client', s.client, 'env', s.env,
           'last_report_at', s.last_report_at, 'last_status', s.last_status,
           'last_heartbeat_at', s.last_heartbeat_at,
           'live', s.live - 'containers', 'live_at', s.live_at,
           'open_issues', (select count(*) from issues i where i.hostname = s.hostname and i.resolved_at is null),
           'payload', r.payload
         ) order by s.hostname), '[]'::jsonb)
  from servers s
  left join reports r on r.id = s.last_report_id
  where not s.archived;
$$;

create or replace function public.sm_server(p_hostname text)
returns jsonb
language sql
stable
security definer
set search_path = server_manager, pg_temp
as $$
  select jsonb_build_object(
           'hostname', s.hostname, 'client', s.client, 'env', s.env,
           'last_report_at', s.last_report_at, 'last_status', s.last_status,
           'last_heartbeat_at', s.last_heartbeat_at,
           'live', s.live, 'live_at', s.live_at,
           'payload', r.payload,
           'issues', coalesce((select jsonb_agg(jsonb_build_object(
                        'key', i.fingerprint, 'check_id', i.check_id, 'severity', i.severity, 'title', i.title,
                        'first_seen_at', i.first_seen_at, 'last_seen_at', i.last_seen_at,
                        'resolved_at', i.resolved_at, 'acknowledged_at', i.acknowledged_at)
                        order by i.resolved_at nulls first, i.first_seen_at desc)
                      from issues i where i.hostname = s.hostname
                        and (i.resolved_at is null or i.resolved_at > now() - interval '7 days')), '[]'::jsonb)
         )
  from servers s
  left join reports r on r.id = s.last_report_id
  where s.hostname = p_hostname;
$$;

revoke all on function public.sm_live(text, jsonb), public.sm_push_report(text, jsonb) from public, authenticated;
grant execute on function public.sm_live(text, jsonb), public.sm_push_report(text, jsonb) to anon, service_role;
revoke all on function public.sm_recheck(text), public.sm_live_fleet(), public.sm_live_server(text) from public, anon, authenticated;
grant execute on function public.sm_recheck(text), public.sm_live_fleet(), public.sm_live_server(text) to service_role;
revoke all on function server_manager.issue_history(text) from public, anon, authenticated;
grant execute on function server_manager.issue_history(text) to service_role;
revoke all on function public.sm_reports(int, text), public.sm_fleet(), public.sm_server(text) from public, anon, authenticated;
grant execute on function public.sm_reports(int, text), public.sm_fleet(), public.sm_server(text) to service_role;

commit;
