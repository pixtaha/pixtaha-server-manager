# Collector

Read-only monitor that runs on every server and sends one payload v1 report a day to the n8n workflow "Server Manager" (see `docs/report/payload-v1.md`).

## What it does
| Timer | When | Job |
|---|---|---|
| `pixtaha-collector-sample.timer` | every 5 minutes | CPU, RAM, disk, swap and container state (restart count, start time, OOM flag) appended to `/var/lib/pixtaha-collector/samples.jsonl` (last 26 h), then the critical alert checks and a heartbeat to the alert webhook (see "Real-time alerts") |
| `pixtaha-collector-report.timer` | 08:55 Africa/Cairo | builds payload v1 from the samples plus live checks and posts it to the webhook (3 tries, 60 s apart) |

On the first day, hours without samples are filled from sysstat (`sadf`) when it is installed.

Daily checks: containers (state, restarts, OOM kills, crash cause from the last 24 h of logs, pinned image, memory limit, published ports), n8n instances (version, SQLite size and growth, workflows, executions ok/failed in 24 h, read with `mode=ro`), databases (engine, version, data size, newest matching backup file), backups folders, systemd timers and cron jobs, failed units, public listeners, SSH settings (`sshd -T`), failed and accepted SSH logins, new login IPs, firewall, executables in /tmp, pending updates, reboot required, domains from nginx / Caddy / Traefik labels (DNS, HTTPS, certificate days, renewal), and changes since the previous report (containers added/removed, image changes, ports opened/closed, reboot).

## Real-time alerts (1.1.0+)
Every sample also runs a few fast critical checks and posts a heartbeat to the n8n workflow "Server Manager Alerts", which sends new problems to Telegram.

| Key | Condition |
|---|---|
| `container.down:<name>` | a container that was running is now exited / dead / restarting, or an n8n / database container with a restart policy is not running |
| `container.oom:<name>` | the container was OOM-killed (held for 30 min, one alert per kill) |
| `host.disk` | root disk >= 90% |
| `host.ram` | RAM >= 95% with swap in use |
| `unit.failed:<unit>` | a systemd unit failed after the collector started watching (units already failed at the first run are ignored until they recover) |
| `domain.down:<name>` | a domain the host serves does not resolve or HTTPS fails (checked at most every 15 min, 2 failed checks in a row) |

- Debounce: a condition must hold for 2 samples in a row before it is sent, so restarts and flaps do not page.
- Sent once: `/var/lib/pixtaha-collector/alerts.json` remembers what was sent. "Resolved" is sent once, after the key has been gone for 2 samples. n8n also dedupes server-side, so a lost state file cannot re-page.
- Max 10 alerts and 10 resolved per POST; the rest go with the next sample.
- POST to `PIXTAHA_ALERT_URL` (default: the report webhook URL with `server-daily-report` replaced by `server-alert`), same `X-Report-Token`, 10 s timeout, no retries: a failed POST is not marked as sent, so the next sample sends it again. A failed POST never fails the sample.
- Body: `{schema_version:"1.0", hostname, client, env, at, collector, heartbeat:true, alerts:[{key,severity,title,detail}], resolved:[{key,title}]}`. Names and numbers only.

## What it never does
- Change anything outside `/var/lib/pixtaha-collector`. No docker exec, no restarts, no writes to databases.
- Read secrets into the report. Container environment values are ignored except `N8N_VERSION`, `DB_TYPE`, `N8N_HOST`, `WEBHOOK_URL`, `N8N_PORT`, `N8N_PROTOCOL`. No file contents, no command lines.
- Print the token. It lives only in `/etc/pixtaha-collector/config.env` (mode 600).

## Install
As root on the server (pin `<ref>` to a commit SHA):

```bash
curl -fsSL https://raw.githubusercontent.com/pixtaha/pixtaha-server-manager/<ref>/collector/install.sh -o /tmp/pixtaha-install.sh
bash /tmp/pixtaha-install.sh --ref <ref> --client "Client name" --env production --webhook https://<n8n-host>/webhook/server-daily-report
```

The installer asks for the report token without echoing it. Running it again upgrades the program and keeps the config (`--reset-token` to change the token).

## Use
```bash
pixtaha-collector status                      # config (no token), samples, last report, heartbeat, open alerts
pixtaha-collector report --dry-run | less     # preview the payload, sends nothing, keeps state
pixtaha-collector report --id-suffix test     # send an extra report now (unique report.id)
journalctl -u pixtaha-collector-report -n 50  # last runs
bash /opt/pixtaha-collector/uninstall.sh      # remove (add --purge to delete config and state)
```

## Optional config keys (`/etc/pixtaha-collector/config.env`)
| Key | Purpose |
|---|---|
| `PIXTAHA_PUBLIC_IP` | public IP when the server sits behind NAT |
| `PIXTAHA_EXTRA_IPS` | comma-separated IPs that domains may resolve to (load balancer, proxy) |
| `PIXTAHA_BACKUP_DIRS` | comma-separated backup folders not found automatically |
| `PIXTAHA_DASHBOARD_URL` | link shown in the email |
| `PIXTAHA_HOSTNAME` | override the reported hostname |
| `PIXTAHA_ALERT_URL` | alert / heartbeat webhook (default derived from `PIXTAHA_WEBHOOK_URL`) |
| `PIXTAHA_ALERT_DOMAINS` | `off` to skip the 15-minute domain check in alerts |

## Limits in v1
- n8n on Postgres: workflow and execution counts are `null` (they need database access).
- Telegram webhook checks, missed schedules and dead-host nodes are `null`.
- Database connections are `null`.

## Test
`bash collector/tests/run.sh` runs the collector against a fake docker CLI and fictional fixtures, checks the payload, runs the alert tests (`tests/test_alerts.py`: debounce, sent once, resolved once, retry after a failed POST, no secrets), and renders the email with the email adapter.
