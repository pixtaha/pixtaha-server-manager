# Supabase: schema `server_manager`

Runs on the self-hosted Supabase. Migrations are plain SQL, additive, and safe to run twice.

| Object | Purpose |
|---|---|
| `server_manager.servers` | one row per server (client, env, last report, last status) |
| `server_manager.reports` | every payload v1 received, full JSON in `payload` |
| `server_manager.issues` | attention items over time: first seen, last seen, resolved, acknowledged |
| `server_manager.latest_reports` | view, newest report per server |
| `server_manager.ingest_report(jsonb)` | called by n8n for every report; idempotent on `report.id` |
| `server_manager.active_alerts` / `alert_events` | real-time alerts open per host, and every alert / resolved / offline / online event (0006) |
| `server_manager.ingest_heartbeat(jsonb)` | called by n8n "Server Manager Alerts" every 5 min per server; dedupes alerts, returns only events to send |
| `server_manager.offline_check(minutes)` | servers silent for more than N minutes (alerted once) and servers back online |
| `public.sm_fleet()` / `public.sm_server(hostname)` | read API for the hub (service_role only), incl. `last_heartbeat_at`, `live` (0007) |
| `public.sm_live(token, snapshot)` / `public.sm_push_report(token, payload)` | collector 1.2.0 live channel (anon role, token checked against its sha256 in `server_manager.settings`): snapshot every 5 s, refresh report every 5 min (0007) |
| `public.sm_live_fleet()` / `public.sm_live_server(hostname)` / `public.sm_recheck(hostname)` | small read API the hub polls every 5 s, and "Re-check now" (service_role only) |
| `server_manager.live_points` | one point per server per minute, kept 48 h (charts) |

Access: RLS is on with no policies, so `anon` and `authenticated` see nothing. n8n uses the role `server_manager_writer`, which can only execute `ingest_report`. The hub calls the two RPC functions server-side with the service role key, so the PostgREST config does not change.

Issues are tracked by the attention `key` that the collector sends (stable while the problem lasts), so the email and hub can show "new today", "open for N days" and "resolved".

## Apply (on the Supabase host, as root)
1. Fresh backup first (the host has a backup job): run it and check the newest file.
2. Apply the migration with `psql` as `postgres` inside the database container (`-v ON_ERROR_STOP=1`).
3. Set the writer password interactively: `\password server_manager_writer`. Keep it in the password manager and in the n8n credential only.

Live channel (0007): after applying, store the token hash once as `postgres`: `select server_manager.set_live_key('<sha256 of the report token>');`. The rollback is at the top of `0007_live.sql`.

Rollback (everything): `drop schema server_manager cascade; drop function public.sm_fleet(); drop function public.sm_server(text); drop role server_manager_writer;`
