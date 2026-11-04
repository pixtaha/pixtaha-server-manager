-- 0003: ingest_report also returns the issue history of the host (open since when, new, resolved),
-- so the daily email can say "new today", "open for N days" and "resolved".
-- Replaces one function and adds one. No data change. Safe to run twice.
-- Rollback: re-run 0002_ingest_tolerant_attention.sql, then: drop function server_manager.issue_history(text);

begin;

-- issue state as of the newest report of a host: what is open (and since when), what that report resolved
create or replace function server_manager.issue_history(p_host text)
returns jsonb
language sql
stable
security definer
set search_path = server_manager, pg_temp
as $$
  with latest as (select max(generated_at) as at, count(*) as n from reports where hostname = p_host)
  select jsonb_build_object(
    'reports', (select n from latest),
    'latest_report_at', (select at from latest),
    'previous_report_at', (select max(generated_at) from reports where hostname = p_host and generated_at < (select at from latest)),
    'open', coalesce((select jsonb_agg(jsonb_build_object(
                'key', i.fingerprint, 'check_id', i.check_id, 'title', i.title, 'severity', i.severity,
                'first_seen_at', i.first_seen_at, 'new', i.first_seen_at = (select at from latest))
              order by i.first_seen_at desc)
              from issues i where i.hostname = p_host and i.resolved_at is null), '[]'::jsonb),
    'resolved', coalesce((select jsonb_agg(jsonb_build_object(
                'key', i.fingerprint, 'check_id', i.check_id, 'title', i.title, 'severity', i.severity,
                'first_seen_at', i.first_seen_at, 'resolved_at', i.resolved_at))
              from issues i where i.hostname = p_host and i.resolved_at = (select at from latest)), '[]'::jsonb)
  );
$$;

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
    return jsonb_build_object('stored', false, 'reason', 'duplicate report id', 'history', issue_history(v_host));
  end if;

  -- only the newest report moves issue state
  if v_at >= (select max(generated_at) from reports where hostname = v_host) then
    with cur as (
      -- collector 1.0.2+ sends a stable `key`; older payloads fall back to id + title
      select distinct on (fp) fp, check_id, severity, title
      from (
        select coalesce(a ->> 'key', coalesce(a ->> 'id', a ->> 'check', 'unknown') || '|' || coalesce(a ->> 'title', '')) as fp,
               coalesce(a ->> 'id', a ->> 'check', 'unknown') as check_id,
               coalesce(a ->> 'severity', 'warning') as severity,
               coalesce(a ->> 'title', '') as title
        from jsonb_array_elements(coalesce(p -> 'attention', '[]'::jsonb)) a
      ) x
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

  return jsonb_build_object('stored', true, 'new_issues', v_new, 'resolved_issues', v_resolved, 'history', issue_history(v_host));
end;
$$;

revoke all on function server_manager.issue_history(text) from public, anon, authenticated;
revoke all on function server_manager.ingest_report(jsonb) from public, anon, authenticated;
grant execute on function server_manager.issue_history(text) to service_role;
grant execute on function server_manager.ingest_report(jsonb) to service_role, server_manager_writer;

commit;
