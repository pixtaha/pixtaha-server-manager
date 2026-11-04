# First Chat Handoff (paste into the first chat of the Server Manager project)

Replace the two placeholders before sending:
- [FRIEND_REPO] -> owner/repo of my friend's container manager on GitHub (or "none yet")
- [DESIGN_SYSTEM_NAME] -> the name of my design system in Claude Design

```
# Handoff: Server Manager kickoff

## Context
I run many Linux servers: my own and my clients'. Two are documented in the knowledge files (private-pixtaha, camera); more will be added with 03-server-discovery-prompt.md. In the last two weeks every serious problem was found by hand, late:
- n8n crashed from heap memory and lost an execution
- one n8n wrote 64GB to disk in 5 days (SQLite 3.7GB)
- a deleted DNS record silently stopped two Telegram bots for a day
- a certificate was 29 days from expiry with renewal failing
- Postgres, rembg and several n8n ports are open to the internet
- a debug route exposed /root (including .bash_history) for months
- SSH accepted root passwords with brute-force attempts
- images on "latest"; a rembg upgrade OOM-crashed
- workflows still call a server that was shut down
Read changelog.md and lessons.md for details. Follow the Project instructions.

## Goal
Build "Server Manager": one dashboard that gives me complete, real-time visibility of every server, every container and image, and every service (n8n, Supabase, databases, custom APIs), plus Telegram alerts before things break. Fleet size: plan for 30+ servers across 10+ clients.

## Decisions already made (defaults, challenge them if wrong)
- v1 is read-only. The agent observes; it never changes anything.
- Push model: a lightweight agent on each server sends a snapshot to the hub every 60s. No inbound ports on client servers.
- The agent never sends env values, file contents or secrets. Names, versions and metrics only. Docker access through a read-only socket proxy.
- Hub: Next.js + Supabase (separate project per environment: dev / demo / prod), hosted off the monitored servers (e.g. Vercel). An external heartbeat watches the hub.
- Login: password (or passkey) + TOTP from Google Authenticator, rate-limited, backup codes, trusted device for 30 days. Not TOTP-only.
- Users in v1: me only. Later: read-only client view, each client sees only their servers (RLS).
- Alerts: Telegram bot, grouped and throttled, with "Acknowledge" buttons and a daily digest at 09:00 Cairo.
- UI: English first, layouts must work mirrored for Arabic (RTL) later. Dark and light. Desktop first, usable on a 375px phone.

## Checks the product must detect (each maps to a real incident)
- Host: CPU, RAM, swap, disk %, disk forecast (days until full), inodes, load, uptime, reboot required, pending security updates
- Containers: status, restarts, OOM kills, CPU, RAM vs limit, missing memory limit, image tag "latest" or unpinned, newer version available, disk write rate
- Ports: every listening port marked public or local; alert on new public ports and on public database ports
- Web: domain resolves to the expected IP, HTTPS status, certificate days left, certbot/renewal failures
- Security: SSH password login enabled, root login, failed logins, firewall off, executables in /tmp, unknown login IPs
- n8n: version, DB size and growth, binary mode, executions failing, active workflows, Telegram webhook registered to the right URL, schedules that did not run, nodes calling dead hosts
- Supabase / databases: up, size, connections, last backup age
- Agent: last heartbeat; "server offline" when silent for 3 minutes
- Changes timeline: new container, image changed, port opened, config changed

## Reference project
My friend shared a container manager with me: [FRIEND_REPO]. Later we will review it to decide what to reuse. Do not depend on it yet.

## Your first task (do only this, then stop)
1. Reply in 3 to 5 lines (Egyptian Arabic) confirming what you understood, plus anything in the decisions above you would challenge.
2. Write ONE prompt in English, in a single code block, that I will paste into Claude Design to get a visual concept of the dashboard. The prompt must:
   - Tell Claude Design to use my existing design system "[DESIGN_SYSTEM_NAME]" (colors, type, components) and not invent a new one. If it cannot find it, ask me before designing.
   - Describe the product in 3 lines and the user (me, a technical operator who wants to see problems in under 5 seconds).
   - List these screens with their exact contents:
     a. Login: email + password, then a 6-digit TOTP step; first-time enrollment with QR code and backup codes
     b. Fleet overview: summary bar (servers, containers, open critical/warning alerts, offline agents), server cards or rows (name, client, env badge, status color, CPU/RAM/disk mini bars, containers up/total, open alerts, last heartbeat), filters by client / env / status, search, sort by severity
     c. Server detail: health header, 24h resource charts, containers table (name, image:tag with "latest"/"pinned" badge, status, restarts, CPU, RAM vs limit, ports public/local), services (n8n instances, Supabase, systemd), domains and TLS, exposed ports, security panel, backups, changes timeline
     d. Container detail: status history, restarts and OOM events, resource charts, image version vs latest available, ports, mounts (paths only)
     e. n8n instance panel: version, DB size trend, executions success/error, active workflows, Telegram webhook status, schedule health
     f. Alerts center: list with severity, server, check, first seen, state (open / acknowledged / resolved), grouped duplicates, bulk acknowledge
     g. Add server: name, client, env, generated one-line install command with copy button, "waiting for first heartbeat" state
     h. Telegram previews: one critical alert message with buttons, and the daily digest message
   - Use realistic sample data from my knowledge files (servers private-pixtaha and camera, containers like n8n-new-zain, supabase-pooler, rembg 2.0.76, product-image-api) plus 8 more fictional servers for scale.
   - Show states: healthy, warning, critical, offline agent, empty fleet, loading.
   - Desktop 1440px for every screen, plus 375px mobile for Fleet overview and Alerts center. Dark mode primary, light mode for Fleet overview.
   - Status must never rely on color alone (icon + text label too).
3. Under the code block, list the assumptions you made in one line each.
Then stop and wait.

## Next steps (later, not now)
- Review [FRIEND_REPO] and decide reuse vs build.
- Kickoff pack in the GitHub repo pixtaha-server-manager: README, CLAUDE.md, docs (brief, architecture, data model, checks catalog, alert rules, roadmap), Supabase migrations with RLS, agent spec.
- Phase 0: agent + hub showing my two documented servers. Phase 1: alerts + Telegram. Phase 2: client view.
```
