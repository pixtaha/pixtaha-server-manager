# Supabase: schema `server_manager`

Runs on the self-hosted Supabase. Migrations are plain SQL, additive, and safe to run twice.

| Object | Purpose |
|---|---|
| `server_manager.servers` | one row per server (client, env, last report, last status) |
| `server_manager.reports` | every payload v1 received, full JSON in `payload` |
| `server_manager.issues` | attention items over time: first seen, last seen, resolved, acknowledged |
| `server_manager.latest_reports` | view, newest report per server |
| `server_manager.ingest_report(jsonb)` | called by n8n for every report; idempotent on `report.id` |
| `public.sm_fleet()` / `public.sm_server(hostname)` | read API for the hub (service_role only) |

Access: RLS is on with no policies, so `anon` and `authenticated` see nothing. n8n uses the role `server_manager_writer`, which can only execute `ingest_report`. The hub calls the two RPC functions server-side with the service role key, so the PostgREST config does not change.

Issues are tracked by the attention `key` that the collector sends (stable while the problem lasts), so the email and hub can show "new today", "open for N days" and "resolved".

## Apply (on the Supabase host, as root)
1. Fresh backup first (the host has a backup job): run it and check the newest file.
2. Apply the migration with `psql` as `postgres` inside the database container (`-v ON_ERROR_STOP=1`).
3. Set the writer password interactively: `\password server_manager_writer`. Keep it in the password manager and in the n8n credential only.

Rollback: `drop schema server_manager cascade; drop function public.sm_fleet(); drop function public.sm_server(text); drop role server_manager_writer;`
