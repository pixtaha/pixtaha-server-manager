# Server Discovery Prompt (for Claude Code on each server)

Run Claude Code on the server as a normal user with sudo (not with --dangerously-skip-permissions), from /root or the home folder, then paste the prompt below. It is read-only. Upload the resulting server-<hostname>.md to the Claude Project and add a row to 00-inventory.md.

```
You are auditing this Linux server in READ-ONLY mode. Your job is to produce one Markdown file describing exactly what runs here.

Hard rules:
- Do not install, change, restart, stop, delete or update anything. No package installs, no docker pull, no config edits, no service restarts.
- Never print secrets: no env values, no .env contents, no full docker inspect, no command lines with tokens, no authorized_keys contents, no .bash_history contents. Env vars and credentials by NAME only.
- If a command needs sudo, show it and wait for my approval.
- Use English only in everything you write.

Collect:
1. System: hostname, public IP (curl -4 ifconfig.me), OS + kernel, uptime, cores, RAM, swap, disks (df -h, df -i), load.
2. Top processes by CPU and RAM (names only, no arguments).
3. Listening ports (ss -tulpn): mark each as PUBLIC (0.0.0.0 / [::]) or LOCAL (127.0.0.1).
4. Docker: every container with name, image:tag (flag "latest" or no tag), status, restart count, ports, memory limit, current CPU/RAM, compose project + working dir (from labels) or "docker run", mounts (source -> destination). Every image with size and age. Volumes and their sizes.
5. Compose projects: list them and flag any two stacks sharing one project name.
6. Services: running and failed systemd units; custom services (ExecStart path only).
7. App specifics:
   - n8n instances: version, DB type, SQLite file size, binary data mode, WEBHOOK_URL / N8N_HOST, number of workflows and active workflows, trigger types and schedules (use n8n export inside the container to /tmp, read it, then delete it).
   - Supabase: compose dir, versions, DB size, number of auth users, public tables with row counts, storage buckets.
   - Any database containers: engine, version, size.
8. Web: nginx/caddy sites (server_name -> upstream), certificates and expiry dates, certbot status, DNS check that each domain resolves to this server's IP.
9. Security: sshd effective settings (passwordauthentication, permitrootlogin, pubkeyauthentication), number of authorized keys and file mtime, failed SSH logins in the last 7 days, last 10 logins (user, IP, date), firewall status, executable files in /tmp /var/tmp /dev/shm, cron jobs per user and /etc/cron.d, pending security updates, reboot required.
10. Logs and crashes: OOM kills (dmesg), files in /var/crash, containers with restarts > 0 and why.
11. Backups: any backup scripts, cron entries or folders and the date of the latest backup file.
12. Risks: a ranked list (critical / high / medium) with one line each.

Output: write server-<hostname>.md in the current folder with these sections:
"# Server: <hostname>", "Last verified: <today>", Summary, Hardware, Access, Domains and TLS, Containers (table), Services (table), App details (n8n / Supabase / other), Security, Backups, Risks, Open items.
Keep it factual. If something could not be checked, write "not checked" and why. Then print the file path and a 5-line summary.
```
