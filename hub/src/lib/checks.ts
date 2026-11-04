import type { AlertCheck } from "./types";

/** Catalog of collector checks (docs/report/payload-v1.md), with the copy used when alerts are grouped. */
export const CHECKS: Record<string, AlertCheck> = {
  "host.disk": { id: "host.disk", name: "Disk filling up", summary: "Disk at 80% or full within 14 days" },
  "host.ram": { id: "host.ram", name: "RAM pressure", summary: "RAM peak at 90% or swapping" },
  "containers.oom": { id: "containers.oom", name: "Container OOM killed", summary: "Containers killed by the kernel for memory" },
  "containers.restarts": { id: "containers.restarts", name: "Container restarting", summary: "Crashed or restarted in 24h" },
  "containers.unpinned": { id: "containers.unpinned", name: "Unpinned image", summary: "Image can change on restart" },
  "containers.no_memory_limit": { id: "containers.no_memory_limit", name: "No memory limit", summary: "App containers can take all host RAM" },
  "ports.public_database": { id: "ports.public_database", name: "Database port public", summary: "Database ports bound to 0.0.0.0" },
  "ports.new_public": { id: "ports.new_public", name: "New public port", summary: "Port not open in the previous report" },
  "domains.dns": { id: "domains.dns", name: "Domain not resolving", summary: "Domain does not point to this server" },
  "domains.cert": { id: "domains.cert", name: "HTTPS or certificate", summary: "HTTPS failing or certificate expiring" },
  "security.ssh_password": { id: "security.ssh_password", name: "SSH password login", summary: "Password login enabled" },
  "security.firewall": { id: "security.firewall", name: "Firewall inactive", summary: "Host firewall disabled" },
  "security.tmp_executables": { id: "security.tmp_executables", name: "Executables in /tmp", summary: "Possible compromise" },
  "security.unknown_login": { id: "security.unknown_login", name: "New login IP", summary: "SSH login from an IP not seen before" },
  "n8n.failed_executions": { id: "n8n.failed_executions", name: "n8n executions failing", summary: "5 or more failed executions in 24h" },
  "n8n.db_growth": { id: "n8n.db_growth", name: "n8n database large", summary: "SQLite over 1 GB or growing fast" },
  "n8n.dead_host_nodes": { id: "n8n.dead_host_nodes", name: "n8n calls a dead host", summary: "HTTP nodes call a host that is down" },
  "n8n.telegram_webhook": { id: "n8n.telegram_webhook", name: "Telegram webhook mismatch", summary: "Registered URL does not match" },
  "backups.age": { id: "backups.age", name: "Backups missing or old", summary: "No backup, or older than 48 hours" },
  "scripts.failed": { id: "scripts.failed", name: "Scheduled job failed", summary: "Last run did not succeed" },
  "agent.heartbeat": { id: "agent.heartbeat", name: "Collector not reporting", summary: "No report from the collector" },
};

export function checkFor(id: string): AlertCheck {
  return CHECKS[id] ?? { id, name: id, summary: "" };
}
