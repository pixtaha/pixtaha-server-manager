# Daily Report Payload v1

Contract between the collector on each server, the n8n workflow "Server Manager", and the daily report email.

## Transport
- `POST https://<n8n-host>/webhook/server-daily-report`
- Headers: `Content-Type: application/json`, `X-Report-Token: <token>` (n8n Header Auth credential "Server Manager Report Token")
- One request per server per day, sent at 08:55 Cairo. n8n builds and sends the email at 09:00.
- Max body: 512 KB. Retries: 3, with 60 s backoff. Same `report.id` twice = duplicate, n8n ignores the second one.

## Rules
- Never include secrets: no env values, no tokens, no file contents, no command lines. Names, versions, counts and metrics only.
- Unknown or not checked = `null`. Not present on this server = block is an empty array or omitted.
- Timestamps in UTC ISO 8601 (`2026-11-05T06:59:00Z`). n8n converts to Cairo time for the email.
- Sizes in MB (disk totals in GB), percentages 0-100, durations in seconds.
- `severity` and `status` values: `healthy`, `info`, `warning`, `critical`, `offline`, `unknown`.
- The collector computes `attention[]` from its checks (see "Checks" below). n8n does not invent issues.

## Top-level shape
| Key | Required | Purpose |
|---|---|---|
| `schema_version` | yes | `"1.0"` |
| `report` | yes | id, type, period, collector version |
| `server` | yes | hostname, client, env, hardware, OS |
| `status` | yes | overall status + counts by severity |
| `kpis` | yes | the 4 email KPI tiles (uptime from `server.uptime_seconds`) |
| `attention` | yes | ranked issues, each with title, impact, action (may be empty) |
| `changes` | yes | changes since the previous report (may be empty) |
| `blocks` | yes | optional workload blocks; the email renders only non-empty ones |

## KPI fields used by the email
| Field | Purpose |
|---|---|
| `kpis.cpu_avg_pct`, `kpis.cpu_peak_pct`, `kpis.cpu_peak_at` | CPU tile |
| `kpis.cpu_hourly_pct` | 24 hourly values for the CPU sparkline (oldest first) |
| `kpis.ram_used_mb` + `server.ram_total_mb` | RAM tile |
| `kpis.disk_used_pct`, `kpis.disk_used_gb`, `server.disk_total_gb`, `kpis.disk_days_until_full` | Disk tile (`null` days = "No growth trend yet") |
| `server.uptime_seconds` | Uptime tile |
| `kpis.ram_hourly_pct`, `kpis.disk_hourly_pct` (optional) | 24 hourly values for the hub Memory and Disk charts (oldest first, `null` = no data) |
| `kpis.ram_peak_pct` (optional) | RAM peak shown on the hub RAM tile |
| `blocks.systemd_units` | `{running, failed}` line under Scripts and services |
| `note` (optional, top level) | overrides the generated manager note |

## Blocks (all optional)
| Block | Renders when | Notes |
|---|---|---|
| `containers` | Docker present | `items[]` holds containers with issues; full list only if 20 or fewer |
| `n8n` | 1+ instances | email shows a table for up to 5, aggregate + issues only above 5 (e.g. 33 instances) |
| `scripts` | 1+ cron / Python scripts | `{name, kind, schedule, last_run_at, last_result, duration_s, status}` |
| `services` | 1+ systemd units, APIs or model services (e.g. siglip2) | `{name, kind, status, state, user, port, public, latency_ms}` |
| `databases` | Supabase / Postgres / Redis / SQLite | `{name, engine, version, status, size_mb, growth_mb_24h, connections, max_connections, last_backup_at}` |
| `domains` | nginx / caddy sites | DNS, HTTPS, certificate days left, renewal |
| `security` | always | SSH, firewall, public ports, failed logins, updates, reboot |
| `backups` | backup folders or jobs found | last backup, age, size |

`changes[]` item: `{type, entity, from, to, at}` with type one of `container_added`, `container_removed`, `image_changed`, `port_opened`, `port_closed`, `config_changed`, `reboot`.

## Checks that produce `attention[]` (v1)
| Check id | Severity | Rule |
|---|---|---|
| `host.disk` | warning / critical | disk >= 80% / >= 90%, or days until full <= 14 / <= 3 |
| `host.ram` | warning / critical | RAM peak >= 90% / swap in use with RAM >= 95% |
| `containers.oom` | critical | any OOM kill in 24h |
| `containers.restarts` | warning | restarts >= 3 in 24h |
| `containers.unpinned` | warning | tag `latest` or no tag |
| `containers.no_memory_limit` | warning | app containers (n8n, APIs) with no limit |
| `ports.public_database` | critical on hosts with firewall off, else warning | 5432, 6543, 3306, 6379, 27017 bound to 0.0.0.0 |
| `ports.new_public` | warning | public port not in yesterday's report |
| `domains.dns` | critical | domain does not resolve to expected IP |
| `domains.cert` | warning / critical | days left <= 21 / <= 7, or renewal failing |
| `security.ssh_password` | critical | password auth enabled |
| `security.firewall` | warning | firewall inactive |
| `security.tmp_executables` | critical | executable files in /tmp, /var/tmp, /dev/shm |
| `n8n.failed_executions` | warning | failed executions >= 5 in 24h |
| `n8n.telegram_webhook` | critical | registered URL does not match the instance |
| `n8n.missed_schedules` | warning | expected schedule runs missing |
| `n8n.dead_host_nodes` | warning | nodes calling a retired host |
| `n8n.db_growth` | warning | SQLite > 1 GB or growth > 100 MB / 24h |
| `backups.age` | warning / critical | last backup older than 48 h / 7 days |

## Example
A full example payload with real server data is kept in the private Claude Project, not in this public repo.
