-- Server Manager: schema server_manager on the self-hosted Supabase.
-- Additive only: creates a new schema and its objects, touches nothing else.
-- Rollback: drop schema server_manager cascade;
--
-- Access model
--   * n8n writes through server_manager.ingest_report(payload) as role server_manager_writer
--     (direct Postgres, execute-only). Its password is set by hand, never stored in git.
--   * The hub reads server-side with the service_role key through two RPC functions in
--     public (public.sm_fleet, public.sm_server), so PostgREST config is not changed.
--     anon / authenticated get nothing.

begin;

create schema if not exists server_manager;

-- one row per monitored server
create table if not exists server_manager.servers (
  hostname        text primary key,
  client          text not null,
  env             text not null check (env in ('production', 'demo', 'dev')),
  public_ip       text,
  first_seen_at   timestamptz not null default now(),
  last_report_at  timestamptz,
  last_report_id  text,
  last_status     text check (last_status in ('healthy', 'info', 'warning', 'critical', 'offline', 'unknown')),
  archived        boolean not null default false
);

-- every payload v1 received (daily reports, test reports, discovery)
create table if not exists server_manager.reports (
  id            text primary key,                     -- payload report.id
  hostname      text not null references server_manager.servers (hostname) on update cascade,
  type          text not null default 'daily',
  generated_at  timestamptz not null,
  status        text not null,
  critical      int  not null default 0,
  warning       int  not null default 0,
  payload       jsonb not null,
  received_at   timestamptz not null default now()
);
create index if not exists reports_hostname_generated_idx on server_manager.reports (hostname, generated_at desc);

-- attention items tracked over time, so reports can say "new today" / "open for N days" / "resolved"
create table if not exists server_manager.issues (
  hostname       text not null references server_manager.servers (hostname) on update cascade,
  fingerprint    text not null,                       -- attention `key` (stable while the problem lasts)
  check_id       text not null,
  severity       text not null,
  title          text not null,
  first_seen_at  timestamptz not null,
  last_seen_at   timestamptz not null,
  resolved_at    timestamptz,
  acknowledged_at timestamptz,
  primary key (hostname, fingerprint)
);
create index if not exists issues_open_idx on server_manager.issues (hostname) where resolved_at is null;

-- latest report per server (security_invoker so RLS of the caller applies)
create or replace view server_manager.latest_reports
with (security_invoker = true) as
select distinct on (r.hostname) r.*
from server_manager.reports r
join server_manager.servers s on s.hostname = r.hostname and not s.archived
order by r.hostname, r.generated_at desc;

-- ingest: upsert server, store report, update issues. Idempotent on report id.
create or replace function server_manager.ingest_report(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = server_manager, pg_temp
as $$
declare
  v_id       text        := p #>> '{report,id}';
  v_host     text        := p #>> '{server,hostname}';
  v_at       timestamptz := (p #>> '{report,generated_at}')::timestamptz;
  v_status   text        := coalesce(p #>> '{status,overall}', 'unknown');
  v_inserted boolean;
  v_new      int := 0;
  v_resolved int := 0;
begin
  if p ->> 'schema_version' is distinct from '1.0' or v_id is null or v_host is null or v_at is null then
    raise exception 'invalid payload: schema_version 1.0, report.id, server.hostname and report.generated_at are required';
  end if;

  insert into servers (hostname, client, env, public_ip, last_report_at, last_report_id, last_status)
  values (v_host, coalesce(p #>> '{server,client}', 'Unknown'), coalesce(p #>> '{server,env}', 'production'),
          p #>> '{server,public_ip}', v_at, v_id, v_status)
  on conflict (hostname) do update set
    client = excluded.client,
    env = excluded.env,
    public_ip = coalesce(excluded.public_ip, servers.public_ip),
    last_report_at = greatest(servers.last_report_at, excluded.last_report_at),
    last_report_id = case when excluded.last_report_at >= coalesce(servers.last_report_at, '-infinity') then excluded.last_report_id else servers.last_report_id end,
    last_status    = case when excluded.last_report_at >= coalesce(servers.last_report_at, '-infinity') then excluded.last_status    else servers.last_status end;

  insert into reports (id, hostname, type, generated_at, status, critical, warning, payload)
  values (v_id, v_host, coalesce(p #>> '{report,type}', 'daily'), v_at, v_status,
          coalesce((p #>> '{status,critical}')::int, 0), coalesce((p #>> '{status,warning}')::int, 0), p)
  on conflict (id) do nothing
  returning true into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('stored', false, 'reason', 'duplicate report id');
  end if;

  -- only the newest report moves issue state
  if v_at >= (select max(generated_at) from reports where hostname = v_host) then
    with cur as (
      -- collector 1.0.2+ sends a stable `key`; older payloads fall back to id + title
      select distinct on (coalesce(a ->> 'key', (a ->> 'id') || '|' || (a ->> 'title')))
             coalesce(a ->> 'key', (a ->> 'id') || '|' || (a ->> 'title')) as fp,
             a ->> 'id' as check_id, a ->> 'severity' as severity, a ->> 'title' as title
      from jsonb_array_elements(coalesce(p -> 'attention', '[]'::jsonb)) a
    ), up as (
      insert into issues (hostname, fingerprint, check_id, severity, title, first_seen_at, last_seen_at)
      select v_host, fp, check_id, severity, title, v_at, v_at from cur
      on conflict (hostname, fingerprint) do update set
        severity = excluded.severity,
        title = excluded.title,
        last_seen_at = excluded.last_seen_at,
        first_seen_at = case when issues.resolved_at is not null then excluded.first_seen_at else issues.first_seen_at end,
        resolved_at = null
      returning (xmax = 0) as is_new
    )
    select count(*) filter (where is_new) into v_new from up;

    update issues set resolved_at = v_at
    where hostname = v_host and resolved_at is null and last_seen_at < v_at;
    get diagnostics v_resolved = row_count;
  end if;

  return jsonb_build_object('stored', true, 'new_issues', v_new, 'resolved_issues', v_resolved);
end;
$$;

-- read API for the hub (service_role only). Lives in public so PostgREST serves it without config changes.
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

-- RLS on, no policies: anon and authenticated see nothing; service_role bypasses RLS.
alter table server_manager.servers enable row level security;
alter table server_manager.reports enable row level security;
alter table server_manager.issues  enable row level security;

revoke all on schema server_manager from public, anon, authenticated;
revoke all on all tables in schema server_manager from public, anon, authenticated;
revoke all on function server_manager.ingest_report(jsonb) from public, anon, authenticated;

grant usage on schema server_manager to service_role;
grant select, insert, update, delete on all tables in schema server_manager to service_role;
grant execute on function server_manager.ingest_report(jsonb) to service_role;

-- Supabase grants execute on new public functions to anon/authenticated by default: take it back.
revoke all on function public.sm_fleet() from public, anon, authenticated;
revoke all on function public.sm_server(text) from public, anon, authenticated;
grant execute on function public.sm_fleet() to service_role;
grant execute on function public.sm_server(text) to service_role;

-- writer role for n8n: can only call ingest_report. Set its password by hand:
--   alter role server_manager_writer password '<from a password manager>';
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'server_manager_writer') then
    create role server_manager_writer login nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;
grant usage on schema server_manager to server_manager_writer;
grant execute on function server_manager.ingest_report(jsonb) to server_manager_writer;

commit;
