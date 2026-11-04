-- 0006: real-time alerts and heartbeats (collector 1.1.0, n8n workflow "Server Manager Alerts").
-- Additive: two columns on servers, two tables, two functions; sm_fleet / sm_server also return
-- last_heartbeat_at. No data change. Safe to run twice.
--
-- Rollback:
--   drop function if exists server_manager.ingest_heartbeat(jsonb);
--   drop function if exists server_manager.offline_check(int);
--   drop table if exists server_manager.alert_events;
--   drop table if exists server_manager.active_alerts;
--   alter table server_manager.servers drop column if exists last_heartbeat_at, drop column if exists offline_alerted_at;
--   then re-run the sm_fleet / sm_server definitions from 0001_server_manager.sql.

begin;

alter table server_manager.servers add column if not exists last_heartbeat_at  timestamptz;
alter table server_manager.servers add column if not exists offline_alerted_at timestamptz;

-- alerts currently open per host (server-side dedupe: a collector restart cannot re-send them)
create table if not exists server_manager.active_alerts (
  hostname   text not null references server_manager.servers (hostname) on update cascade,
  key        text not null,
  title      text not null,
  detail     text,
  opened_at  timestamptz not null,
  primary key (hostname, key)
);

-- every event that was (or should be) sent to Telegram
create table if not exists server_manager.alert_events (
  id        bigint generated always as identity primary key,
  hostname  text not null references server_manager.servers (hostname) on update cascade,
  key       text not null,
  kind      text not null check (kind in ('alert', 'resolved', 'offline', 'online')),
  title     text not null,
  detail    text,
  at        timestamptz not null default now()
);
create index if not exists alert_events_hostname_at_idx on server_manager.alert_events (hostname, at desc);

alter table server_manager.active_alerts enable row level security;
alter table server_manager.alert_events  enable row level security;
revoke all on server_manager.active_alerts, server_manager.alert_events from public, anon, authenticated;
grant select, insert, update, delete on server_manager.active_alerts, server_manager.alert_events to service_role;

-- heartbeat from the collector: updates last_heartbeat_at and returns only the events to send now
create or replace function server_manager.ingest_heartbeat(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = server_manager, pg_temp
as $$
declare
  v_host   text        := p ->> 'hostname';
  v_at     timestamptz := least(coalesce((p ->> 'at')::timestamptz, now()), now());
  v_env    text        := coalesce(p ->> 'env', 'production');
  v_events jsonb       := '[]'::jsonb;
  v_client text;
  a        jsonb;
  v_open   timestamptz;
begin
  if p ->> 'schema_version' is distinct from '1.0' or v_host is null or v_host = '' then
    raise exception 'invalid heartbeat: schema_version 1.0 and hostname are required';
  end if;
  if v_env not in ('production', 'demo', 'dev') then
    v_env := 'production';
  end if;

  insert into servers (hostname, client, env, last_heartbeat_at)
  values (v_host, coalesce(nullif(p ->> 'client', ''), 'Unknown'), v_env, v_at)
  on conflict (hostname) do update set
    last_heartbeat_at = greatest(servers.last_heartbeat_at, excluded.last_heartbeat_at)
  returning client into v_client;

  for a in select * from jsonb_array_elements(coalesce(p -> 'alerts', '[]'::jsonb)) limit 50 loop
    continue when coalesce(a ->> 'key', '') = '';
    insert into active_alerts (hostname, key, title, detail, opened_at)
    values (v_host, a ->> 'key', left(coalesce(a ->> 'title', a ->> 'key'), 200), left(a ->> 'detail', 500), v_at)
    on conflict (hostname, key) do nothing;
    if found then
      insert into alert_events (hostname, key, kind, title, detail, at)
      values (v_host, a ->> 'key', 'alert', left(coalesce(a ->> 'title', a ->> 'key'), 200), left(a ->> 'detail', 500), v_at);
      v_events := v_events || jsonb_build_object(
        'kind', 'alert', 'hostname', v_host, 'client', v_client, 'key', a ->> 'key',
        'severity', coalesce(a ->> 'severity', 'critical'),
        'title', left(coalesce(a ->> 'title', a ->> 'key'), 200), 'detail', left(a ->> 'detail', 500), 'at', v_at);
    end if;
  end loop;

  for a in select * from jsonb_array_elements(coalesce(p -> 'resolved', '[]'::jsonb)) limit 50 loop
    continue when coalesce(a ->> 'key', '') = '';
    delete from active_alerts where hostname = v_host and key = a ->> 'key'
    returning opened_at into v_open;
    if found then
      insert into alert_events (hostname, key, kind, title, detail, at)
      values (v_host, a ->> 'key', 'resolved', left(coalesce(a ->> 'title', a ->> 'key'), 200), null, v_at);
      v_events := v_events || jsonb_build_object(
        'kind', 'resolved', 'hostname', v_host, 'client', v_client, 'key', a ->> 'key',
        'title', left(coalesce(a ->> 'title', a ->> 'key'), 200), 'at', v_at, 'opened_at', v_open,
        'duration_s', greatest(0, extract(epoch from v_at - v_open))::bigint);
    end if;
  end loop;

  return jsonb_build_object('hostname', v_host, 'events', v_events);
end;
$$;

-- servers silent for more than p_minutes (alerted once, marked) and servers that came back ('online')
create or replace function server_manager.offline_check(p_minutes int default 15)
returns jsonb
language plpgsql
security definer
set search_path = server_manager, pg_temp
as $$
declare
  v_now    timestamptz := now();
  v_events jsonb := '[]'::jsonb;
  s        record;
begin
  for s in
    update servers set offline_alerted_at = v_now
    where not archived and last_heartbeat_at is not null and offline_alerted_at is null
      and last_heartbeat_at < v_now - make_interval(mins => greatest(coalesce(p_minutes, 15), 5))
    returning hostname, client, last_heartbeat_at
  loop
    insert into alert_events (hostname, key, kind, title, detail, at)
    values (s.hostname, 'server.offline', 'offline', 'Server offline', 'No heartbeat since ' || s.last_heartbeat_at, v_now);
    v_events := v_events || jsonb_build_object(
      'kind', 'offline', 'hostname', s.hostname, 'client', s.client, 'key', 'server.offline',
      'title', 'Server offline', 'last_heartbeat_at', s.last_heartbeat_at, 'at', v_now,
      'silent_s', extract(epoch from v_now - s.last_heartbeat_at)::bigint);
  end loop;

  for s in
    with back as (
      select hostname, offline_alerted_at from servers
      where offline_alerted_at is not null and last_heartbeat_at > offline_alerted_at
      for update
    )
    update servers v set offline_alerted_at = null
    from back b where v.hostname = b.hostname
    returning v.hostname, v.client, v.last_heartbeat_at, b.offline_alerted_at as was_offline_at
  loop
    insert into alert_events (hostname, key, kind, title, detail, at)
    values (s.hostname, 'server.offline', 'online', 'Server back online', null, v_now);
    v_events := v_events || jsonb_build_object(
      'kind', 'online', 'hostname', s.hostname, 'client', s.client, 'key', 'server.offline',
      'title', 'Server back online', 'last_heartbeat_at', s.last_heartbeat_at, 'at', v_now,
      'offline_since', s.was_offline_at);
  end loop;

  return v_events;
end;
$$;

revoke all on function server_manager.ingest_heartbeat(jsonb) from public, anon, authenticated;
revoke all on function server_manager.offline_check(int) from public, anon, authenticated;
grant execute on function server_manager.ingest_heartbeat(jsonb) to server_manager_writer, service_role;
grant execute on function server_manager.offline_check(int) to server_manager_writer, service_role;

-- hub read API: same as 0001 plus last_heartbeat_at
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

revoke all on function public.sm_fleet() from public, anon, authenticated;
revoke all on function public.sm_server(text) from public, anon, authenticated;
grant execute on function public.sm_fleet() to service_role;
grant execute on function public.sm_server(text) to service_role;

commit;
