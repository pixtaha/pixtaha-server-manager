export type Status = "critical" | "warning" | "offline" | "healthy";
export type Env = "production" | "demo" | "dev";

export const STATUS_ORDER: Record<Status, number> = { critical: 0, warning: 1, offline: 2, healthy: 3 };
export const STATUS_LABEL: Record<Status, string> = {
  critical: "Critical",
  warning: "Warning",
  offline: "Offline",
  healthy: "Healthy",
};

/** One row of the Fleet overview. Built from the latest payload v1 of each server. */
export interface ServerSummary {
  hostname: string;
  client: string;
  env: Env;
  status: Status;
  /** Short reason shown under the status pill, e.g. "Firewall inactive". */
  note: string;
  cpuPct: number | null;
  ramPct: number | null;
  diskPct: number | null;
  /** Workload chips, e.g. "5 n8n", "Supabase", "Python ×2". */
  workloads: string[];
  alertsCritical: number;
  alertsWarning: number;
  containersUp: number;
  containersTotal: number;
  /** ISO timestamp of the last report or heartbeat. */
  lastSeenAt: string;
}

export interface FleetSnapshot {
  generatedAt: string;
  sample: boolean;
  servers: ServerSummary[];
}

/* ------------------------------------------------------------------ */
/* Server detail. Mirrors docs/report/payload-v1.md (snake_case keys,   */
/* so a stored payload maps 1:1). Every block is optional: a section    */
/* renders only when the server has that workload.                      */
/* ------------------------------------------------------------------ */

/** Severity / status values used across payload v1. */
export type Severity = "healthy" | "info" | "warning" | "critical" | "offline" | "unknown";

export interface ReportMeta {
  id: string;
  type: "daily" | "heartbeat";
  generated_at: string;
  period_start: string;
  period_end: string;
  collector_version: string;
}

export interface ServerInfo {
  hostname: string;
  client: string;
  env: Env;
  cores: number;
  ram_total_mb: number;
  disk_total_gb: number;
  os: string;
  kernel?: string;
  public_ip?: string | null;
  uptime_seconds: number;
  /** Hub addition: last heartbeat (the daily report is one per day, heartbeats every 30 s). */
  last_heartbeat_at: string;
}

export interface StatusCounts {
  overall: Severity;
  critical: number;
  warning: number;
  info: number;
}

export interface Kpis {
  cpu_avg_pct: number | null;
  cpu_peak_pct: number | null;
  cpu_peak_at: string | null;
  /** 24 hourly values, oldest first. `null` = no data for that hour. */
  cpu_hourly_pct: (number | null)[];
  /** Optional, hub charts: 24 hourly RAM used %, oldest first. */
  ram_hourly_pct?: (number | null)[];
  /** Optional, hub charts: 24 hourly disk used %, oldest first. */
  disk_hourly_pct?: (number | null)[];
  ram_used_mb: number | null;
  ram_peak_pct?: number | null;
  disk_used_pct: number | null;
  disk_used_gb: number | null;
  /** `null` = no growth trend yet. */
  disk_days_until_full: number | null;
}

export interface AttentionItem {
  /** Check id from payload v1, e.g. `security.firewall`. */
  id: string;
  severity: Severity;
  title: string;
  impact: string;
  action: string;
}

export type ChangeType = "container_added" | "container_removed" | "image_changed" | "port_opened" | "port_closed" | "config_changed" | "reboot";

export interface ChangeItem {
  type: ChangeType;
  entity: string;
  from: string | null;
  to: string | null;
  at: string;
}

export interface ContainerPort {
  port: number;
  /** `0.0.0.0` = published on every interface, `127.0.0.1` = local only. */
  bind: string;
  public: boolean;
}

export interface ContainerItem {
  name: string;
  image: string;
  /** `null` = no tag (treated like "latest"). */
  tag: string | null;
  pinned: boolean;
  status: Severity;
  /** Docker state: running, restarting, exited, paused. */
  state: string;
  restarts_24h: number;
  oom_kills_24h: number;
  cpu_pct: number | null;
  mem_mb: number | null;
  /** `null` = no memory limit. */
  mem_limit_mb: number | null;
  ports: ContainerPort[];
  issue?: string;
}

export interface ContainersBlock {
  running: number;
  total: number;
  restarts_24h: number;
  oom_kills_24h: number;
  unpinned_images: number;
  missing_memory_limit: number;
  /** Full list when total <= 20, otherwise only containers with issues. */
  items: ContainerItem[];
}

export interface N8nInstance {
  name: string;
  container: string;
  version: string;
  pinned: boolean;
  status: Severity;
  workflows_active: number;
  workflows_total: number;
  executions_ok_24h: number;
  executions_failed_24h: number;
  db_type: "sqlite" | "postgresdb";
  db_size_mb: number;
  db_growth_mb_24h: number;
  mem_limit_mb: number | null;
  telegram_webhooks: { bot: string; ok: boolean }[];
  schedules_missed_24h: number;
  dead_host_nodes: number;
}

export interface ScriptItem {
  name: string;
  kind: "cron" | "python" | "shell";
  schedule: string | null;
  last_run_at: string | null;
  last_result: "ok" | "failed" | null;
  duration_s: number | null;
  status: Severity;
}

export interface ServiceItem {
  name: string;
  kind: "systemd" | "api" | "model" | "container";
  status: Severity;
  state: string;
  user: string | null;
  port: number | null;
  public: boolean;
  latency_ms: number | null;
}

export interface DatabaseItem {
  name: string;
  engine: "Postgres" | "Supabase" | "Redis" | "SQLite" | "MySQL";
  version: string | null;
  status: Severity;
  size_mb: number | null;
  growth_mb_24h: number | null;
  connections: number | null;
  max_connections: number | null;
  last_backup_at: string | null;
}

export interface DomainItem {
  domain: string;
  server: "nginx" | "caddy" | "traefik";
  resolves_to: string | null;
  resolves_ok: boolean;
  https_ok: boolean;
  cert_days_left: number | null;
  renewal_ok: boolean | null;
}

export interface PublicPort {
  port: number;
  proto: "tcp" | "udp";
  bind: string;
  owner: string;
  is_database: boolean;
}

export interface SecurityBlock {
  ssh_password_auth: boolean;
  ssh_root_login: "no" | "prohibit-password" | "without-password" | "yes";
  failed_logins_24h: number | null;
  firewall_active: boolean;
  unknown_login_ips: string[];
  tmp_executables: number;
  pending_security_updates: number | null;
  reboot_required: boolean;
  public_ports: PublicPort[];
}

export interface BackupItem {
  name: string;
  kind: "folder" | "job";
  last_at: string | null;
  size_mb: number | null;
  status: Severity;
}

export interface DetailBlocks {
  containers?: ContainersBlock;
  n8n?: { instances: N8nInstance[] };
  scripts?: ScriptItem[];
  services?: ServiceItem[];
  systemd_units?: { running: number; failed: number };
  databases?: DatabaseItem[];
  domains?: DomainItem[];
  security?: SecurityBlock;
  backups?: BackupItem[];
}

/** The latest payload v1 for one server, as the hub stores it. */
export interface ServerDetail {
  schema_version: "1.0";
  report: ReportMeta;
  server: ServerInfo;
  status: StatusCounts;
  kpis: Kpis;
  attention: AttentionItem[];
  changes: ChangeItem[];
  blocks: DetailBlocks;
  /** Hub addition: fleet status (adds `offline` when heartbeats stop). */
  hub_status: Status;
  sample?: boolean;
}
