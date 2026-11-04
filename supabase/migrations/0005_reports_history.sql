-- 0005: report history for the hub (Daily reports page). Read-only functions, service_role only.
-- Adds two functions, no data change. Safe to run twice.
-- Rollback: drop function public.sm_reports(int, text); drop function public.sm_report(text);

begin;

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
           -- counted from the attention list: older payloads did not fill status.critical / status.warning
           (select count(*) from jsonb_array_elements(coalesce(r.payload -> 'attention', '[]'::jsonb)) a where a ->> 'severity' = 'critical') as critical,
           (select count(*) from jsonb_array_elements(coalesce(r.payload -> 'attention', '[]'::jsonb)) a where a ->> 'severity' = 'warning') as warning
    from reports r join servers s on s.hostname = r.hostname
    where (p_hostname is null or r.hostname = p_hostname)
    order by r.generated_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  ) x;
$$;

create or replace function public.sm_report(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = server_manager, pg_temp
as $$
  select jsonb_build_object('id', r.id, 'hostname', r.hostname, 'client', s.client, 'env', s.env,
                            'generated_at', r.generated_at, 'received_at', r.received_at, 'payload', r.payload)
  from reports r join servers s on s.hostname = r.hostname
  where r.id = p_id;
$$;

revoke all on function public.sm_reports(int, text) from public, anon, authenticated;
revoke all on function public.sm_report(text) from public, anon, authenticated;
grant execute on function public.sm_reports(int, text) to service_role;
grant execute on function public.sm_report(text) to service_role;

commit;
