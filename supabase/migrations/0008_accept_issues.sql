-- 0008: "Accept" an attention item in the hub (a known risk Taha decided to keep, for example unpinned
-- images that would need a recreate). Accepted items stay visible but no longer set the server status.
-- Additive: three columns on issues, one function; sm_fleet / sm_server also return acceptance.
-- No data change. Safe to run twice.
--
-- Rollback:
--   drop function if exists public.sm_issue_accept(text, text, boolean, text, text);
--   alter table server_manager.issues drop column if exists accepted_at, drop column if exists accepted_note,
--     drop column if exists accepted_by;
--   then re-run the sm_fleet / sm_server part of 0007_live.sql.

begin;

alter table server_manager.issues add column if not exists accepted_at   timestamptz;
alter table server_manager.issues add column if not exists accepted_note text;
alter table server_manager.issues add column if not exists accepted_by   text;

-- hub: accept (p_accept true) or undo (false) one issue by its key; the key stays accepted if it comes back
create or replace function public.sm_issue_accept(p_hostname text, p_key text, p_accept boolean, p_note text default null, p_by text default null)
returns jsonb
language sql
security definer
set search_path = server_manager, pg_temp
as $$
  update issues set
    accepted_at   = case when p_accept then now() else null end,
    accepted_note = case when p_accept then left(nullif(trim(p_note), ''), 300) else null end,
    accepted_by   = case when p_accept then left(p_by, 200) else null end
  where hostname = p_hostname and fingerprint = p_key
  returning jsonb_build_object('hostname', hostname, 'key', fingerprint, 'accepted_at', accepted_at);
$$;

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
           'accepted', coalesce((select jsonb_agg(i.fingerprint) from issues i
                                 where i.hostname = s.hostname and i.accepted_at is not null), '[]'::jsonb),
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
                        'resolved_at', i.resolved_at, 'acknowledged_at', i.acknowledged_at,
                        'accepted_at', i.accepted_at, 'accepted_note', i.accepted_note, 'accepted_by', i.accepted_by)
                        order by i.resolved_at nulls first, i.first_seen_at desc)
                      from issues i where i.hostname = s.hostname
                        and (i.resolved_at is null or i.resolved_at > now() - interval '7 days'
                             or i.accepted_at is not null)), '[]'::jsonb)
         )
  from servers s
  left join reports r on r.id = s.last_report_id
  where s.hostname = p_hostname;
$$;

revoke all on function public.sm_issue_accept(text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.sm_issue_accept(text, text, boolean, text, text) to service_role;
revoke all on function public.sm_fleet(), public.sm_server(text) from public, anon, authenticated;
grant execute on function public.sm_fleet(), public.sm_server(text) to service_role;

commit;
