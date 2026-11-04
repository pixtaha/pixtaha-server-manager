import type {
  AttentionItem,
  BackupItem,
  ChangeItem,
  ContainerItem,
  ContainerPort,
  ContainersBlock,
  DatabaseItem,
  DomainItem,
  N8nInstance,
  PublicPort,
  ScriptItem,
  SecurityBlock,
  ServerDetail,
  ServerSummary,
  ServiceItem,
  Severity,
  FleetSnapshot,
} from "./types";

/**
 * Sample fleet for the public demo build.
 * Every hostname and client here is fictional: real server data never goes into this repo.
 * Shapes and numbers mirror the Claude Design concept so the screens can be reviewed before the collector runs.
 */
const NOW = Date.parse("2026-11-04T07:14:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

const s = (v: ServerSummary) => v;

export const SAMPLE_FLEET: FleetSnapshot = {
  generatedAt: new Date(NOW).toISOString(),
  sample: true,
  servers: [
    s({ hostname: "core-01", client: "Pixtaha", env: "production", status: "critical", note: "Public database ports", cpuPct: 21, ramPct: 68, diskPct: 28, workloads: ["5 n8n", "Supabase", "Python ×2", "siglip2"], alertsCritical: 1, alertsWarning: 4, containersUp: 21, containersTotal: 21, lastSeenAt: ago(14) }),
    s({ hostname: "nilehub-api", client: "Nile Hub Logistics", env: "production", status: "critical", note: "3 OOM kills in 24h", cpuPct: 78, ramPct: 96, diskPct: 52, workloads: ["Flask API ×3", "Postgres", "Redis"], alertsCritical: 1, alertsWarning: 1, containersUp: 7, containersTotal: 8, lastSeenAt: ago(9) }),
    s({ hostname: "lens-studio", client: "Lens Studio", env: "production", status: "warning", note: "Firewall inactive", cpuPct: 9, ramPct: 44, diskPct: 23, workloads: ["1 n8n", "Supabase", "rembg", "Flask API"], alertsCritical: 0, alertsWarning: 4, containersUp: 15, containersTotal: 15, lastSeenAt: ago(11) }),
    s({ hostname: "souq-sahel-web", client: "Souq Sahel", env: "production", status: "warning", note: "Disk 87% · 11 days until full", cpuPct: 31, ramPct: 58, diskPct: 87, workloads: ["Next.js", "Supabase"], alertsCritical: 0, alertsWarning: 1, containersUp: 12, containersTotal: 12, lastSeenAt: ago(6) }),
    s({ hostname: "dentaplus-crm", client: "DentaPlus Clinics", env: "production", status: "offline", note: "Last seen 7m ago", cpuPct: null, ramPct: null, diskPct: null, workloads: ["2 n8n", "Postgres"], alertsCritical: 0, alertsWarning: 0, containersUp: 0, containersTotal: 3, lastSeenAt: ago(420) }),
    s({ hostname: "flows-platform", client: "Flows Academy", env: "production", status: "healthy", note: "", cpuPct: 34, ramPct: 60, diskPct: 46, workloads: ["33 n8n", "Next.js", "Postgres"], alertsCritical: 0, alertsWarning: 0, containersUp: 38, containersTotal: 38, lastSeenAt: ago(8) }),
    s({ hostname: "facility-ops", client: "Delta Facility Co", env: "production", status: "healthy", note: "", cpuPct: 6, ramPct: 33, diskPct: 31, workloads: ["1 n8n", "Postgres"], alertsCritical: 0, alertsWarning: 0, containersUp: 9, containersTotal: 9, lastSeenAt: ago(13) }),
    s({ hostname: "redsea-tours", client: "Red Sea Tours", env: "production", status: "healthy", note: "", cpuPct: 12, ramPct: 41, diskPct: 38, workloads: ["3 n8n", "Next.js"], alertsCritical: 0, alertsWarning: 0, containersUp: 6, containersTotal: 6, lastSeenAt: ago(5) }),
    s({ hostname: "greenleaf-ml", client: "Greenleaf Agritech", env: "production", status: "healthy", note: "", cpuPct: 44, ramPct: 71, diskPct: 52, workloads: ["Python ×4", "Model service"], alertsCritical: 0, alertsWarning: 0, containersUp: 4, containersTotal: 4, lastSeenAt: ago(10) }),
    s({ hostname: "delta-legal-demo", client: "Delta Legal", env: "demo", status: "healthy", note: "", cpuPct: 4, ramPct: 22, diskPct: 18, workloads: ["3 n8n"], alertsCritical: 0, alertsWarning: 0, containersUp: 3, containersTotal: 3, lastSeenAt: ago(12) }),
    s({ hostname: "cairo-print-shop", client: "Cairo Print Co", env: "demo", status: "healthy", note: "", cpuPct: 3, ramPct: 19, diskPct: 14, workloads: ["Flask API", "SQLite"], alertsCritical: 0, alertsWarning: 0, containersUp: 2, containersTotal: 2, lastSeenAt: ago(7) }),
    s({ hostname: "mansoura-dev", client: "Pixtaha", env: "dev", status: "healthy", note: "", cpuPct: 15, ramPct: 37, diskPct: 41, workloads: ["Python ×4", "Supabase"], alertsCritical: 0, alertsWarning: 0, containersUp: 4, containersTotal: 4, lastSeenAt: ago(4) }),
  ],
};

/* ================================================================== */
/* Server detail sample data (payload v1 shape).                       */
/* Fictional: client domains use the reserved `.example` TLD and IPs   */
/* come from the RFC 5737 documentation range 203.0.113.0/24.          */
/* ================================================================== */

const H = 3600;
const hAgo = (hours: number) => ago(Math.round(hours * H));
const MB = 1024;

/** Deterministic pseudo-random numbers per hostname, so charts are stable between builds. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Hour index 0 is 23h ago, index 23 is the current hour. Cairo is UTC+2, NOW is 09:14 Cairo. */
const cairoHourAt = (i: number) => (9 - (23 - i) + 48) % 24;
const busy = (i: number) => {
  const hr = cairoHourAt(i);
  return hr >= 9 && hr <= 22 ? 1 : 0.62;
};

/** 24 hourly values with a day/night rhythm that end at `last`, plus an optional spike. */
function wave(seed: string, last: number, spread: number, spike?: { hoursAgo: number; value: number }) {
  const r = rng(seed);
  const base = last / busy(23);
  const out = Array.from({ length: 24 }, (_, i) => round1(clamp(base * busy(i) + (r() - 0.5) * spread)));
  out[23] = last;
  if (spike) out[23 - spike.hoursAgo] = spike.value;
  return out;
}

/** Slow linear growth that ends at `last` (disk). */
const ramp = (last: number, growthPct24h: number) => Array.from({ length: 24 }, (_, i) => round1(clamp(last - (growthPct24h * (23 - i)) / 23)));

const port = (p: number, pub = false): ContainerPort => ({ port: p, bind: pub ? "0.0.0.0" : "127.0.0.1", public: pub });

function c(name: string, image: string, tag: string | null, cpu: number, memMb: number, limitMb: number | null, ports: ContainerPort[] = [], extra: Partial<ContainerItem> = {}): ContainerItem {
  return {
    name,
    image,
    tag,
    pinned: tag != null && tag !== "latest",
    status: "healthy",
    state: "running",
    restarts_24h: 0,
    oom_kills_24h: 0,
    cpu_pct: cpu,
    mem_mb: memMb,
    mem_limit_mb: limitMb,
    ports,
    ...extra,
  };
}

/** Counts are derived from the items unless the server has more than 20 containers (items = issues only). */
function containers(items: ContainerItem[], totals?: { total: number; running: number; unpinned: number; noLimit: number }): ContainersBlock {
  return {
    running: totals?.running ?? items.filter((x) => x.state === "running").length,
    total: totals?.total ?? items.length,
    restarts_24h: items.reduce((n, x) => n + x.restarts_24h, 0),
    oom_kills_24h: items.reduce((n, x) => n + x.oom_kills_24h, 0),
    unpinned_images: totals?.unpinned ?? items.filter((x) => !x.pinned).length,
    missing_memory_limit: totals?.noLimit ?? items.filter((x) => x.mem_limit_mb == null).length,
    items,
  };
}

function supabaseStack(prefix: string, opts: { pooler?: ContainerPort[]; lite?: boolean } = {}): ContainerItem[] {
  const full = [
    c(`${prefix}-db`, "supabase/postgres", "15.8.1.060", 3.4, 1180, 4096, [port(5433)]),
    c(`${prefix}-kong`, "kong", "2.8.1", 0.4, 210, 512, [port(8000)]),
    c(`${prefix}-auth`, "supabase/gotrue", "v2.177.0", 0.1, 34, 256),
    c(`${prefix}-rest`, "postgrest/postgrest", "v12.2.12", 0.2, 48, 256),
    c(`${prefix}-realtime`, "supabase/realtime", "v2.34.47", 0.6, 182, 512),
    c(`${prefix}-storage`, "supabase/storage-api", "v1.25.7", 0.2, 96, 512),
    c(`${prefix}-imgproxy`, "darthsim/imgproxy", "v3.8.0", 0.1, 64, 512),
    c(`${prefix}-meta`, "supabase/postgres-meta", "v0.91.0", 0.1, 72, 256),
    c(`${prefix}-studio`, "supabase/studio", "2025.06.30-sha-6f5982d", 0.2, 160, 512, [port(3000)]),
    c(`${prefix}-analytics`, "supabase/logflare", "1.14.2", 0.8, 420, 1024),
    c(`${prefix}-pooler`, "supabase/supavisor", "2.5.7", 0.3, 118, 512, opts.pooler ?? [port(5432), port(6543)]),
    c(`${prefix}-edge-functions`, "supabase/edge-runtime", "v1.69.6", 0.1, 58, 256),
  ];
  return opts.lite ? full.filter((x) => /-(db|kong|auth|rest)$/.test(x.name)) : full;
}

function n8n(name: string, version: string, wf: [number, number], exec: [number, number], extra: Partial<N8nInstance> = {}): N8nInstance {
  return {
    name,
    container: name,
    version,
    pinned: true,
    status: "healthy",
    workflows_active: wf[0],
    workflows_total: wf[1],
    executions_ok_24h: exec[0],
    executions_failed_24h: exec[1],
    db_type: "sqlite",
    db_size_mb: 180,
    db_growth_mb_24h: 4,
    mem_limit_mb: 1024,
    telegram_webhooks: [],
    schedules_missed_24h: 0,
    dead_host_nodes: 0,
    ...extra,
  };
}

const pp = (p: number, owner: string, isDb = false): PublicPort => ({ port: p, proto: "tcp", bind: "0.0.0.0", owner, is_database: isDb });
const WEB_PORTS = (proxy: string) => [pp(22, "sshd"), pp(80, proxy), pp(443, proxy)];

function security(over: Partial<SecurityBlock> = {}): SecurityBlock {
  return {
    ssh_password_auth: false,
    ssh_root_login: "prohibit-password",
    failed_logins_24h: 0,
    firewall_active: true,
    unknown_login_ips: [],
    tmp_executables: 0,
    pending_security_updates: 2,
    reboot_required: false,
    public_ports: WEB_PORTS("nginx"),
    ...over,
  };
}

const dom = (domain: string, days: number, over: Partial<DomainItem> = {}): DomainItem => ({
  domain,
  server: "nginx",
  resolves_to: "203.0.113.10",
  resolves_ok: true,
  https_ok: true,
  cert_days_left: days,
  renewal_ok: true,
  ...over,
});

const db = (name: string, engine: DatabaseItem["engine"], version: string | null, sizeMb: number, growth: number, conn: [number, number] | null, backupHoursAgo: number | null, over: Partial<DatabaseItem> = {}): DatabaseItem => ({
  name,
  engine,
  version,
  status: "healthy",
  size_mb: sizeMb,
  growth_mb_24h: growth,
  connections: conn ? conn[0] : null,
  max_connections: conn ? conn[1] : null,
  last_backup_at: backupHoursAgo == null ? null : hAgo(backupHoursAgo),
  ...over,
});

const backup = (name: string, kind: BackupItem["kind"], hoursAgo: number | null, sizeMb: number | null, status: Severity = "healthy"): BackupItem => ({
  name,
  kind,
  last_at: hoursAgo == null ? null : hAgo(hoursAgo),
  size_mb: sizeMb,
  status,
});

const script = (name: string, kind: ScriptItem["kind"], schedule: string | null, lastHoursAgo: number, durationS: number, result: "ok" | "failed" = "ok"): ScriptItem => ({
  name,
  kind,
  schedule,
  last_run_at: hAgo(lastHoursAgo),
  last_result: result,
  duration_s: durationS,
  status: result === "ok" ? "healthy" : "warning",
});

const svc = (name: string, kind: ServiceItem["kind"], over: Partial<ServiceItem> = {}): ServiceItem => ({
  name,
  kind,
  status: "healthy",
  state: "running",
  user: null,
  port: null,
  public: false,
  latency_ms: null,
  ...over,
});

const change = (type: ChangeItem["type"], entity: string, from: string | null, to: string | null, hoursAgo: number): ChangeItem => ({ type, entity, from, to, at: hAgo(hoursAgo) });

const warn = (id: string, title: string, impact: string, action: string): AttentionItem => ({ id, severity: "warning", title, impact, action });
const crit = (id: string, title: string, impact: string, action: string): AttentionItem => ({ id, severity: "critical", title, impact, action });

interface DetailSpec {
  hw: { cores: number; ramGb: number; diskGb: number; os: string; kernel: string };
  uptimeDays: number;
  /** Last known values when the fleet row has none (offline). */
  last?: { cpu: number; ram: number; disk: number };
  cpuSpike?: { hoursAgo: number; value: number };
  ramSpike?: { hoursAgo: number; value: number };
  diskGrowthPct24h: number;
  diskDaysUntilFull: number | null;
  attention?: AttentionItem[];
  changes?: ChangeItem[];
  blocks: ServerDetail["blocks"];
}

function detail(summary: ServerSummary, spec: DetailSpec): ServerDetail {
  const host = summary.hostname;
  const cpuNow = summary.cpuPct ?? spec.last?.cpu ?? 0;
  const ramNow = summary.ramPct ?? spec.last?.ram ?? 0;
  const diskNow = summary.diskPct ?? spec.last?.disk ?? 0;
  const cpu = wave(`${host}:cpu`, cpuNow, Math.max(4, cpuNow * 0.5), spec.cpuSpike);
  const ram = wave(`${host}:ram`, ramNow, 4, spec.ramSpike).map((v) => clamp(Math.max(v, ramNow - 12)));
  const disk = ramp(diskNow, spec.diskGrowthPct24h);
  const peakIdx = cpu.indexOf(Math.max(...cpu));
  const ramTotalMb = spec.hw.ramGb * MB;
  const attention = spec.attention ?? [];
  const nCrit = attention.filter((a) => a.severity === "critical").length;
  const nWarn = attention.filter((a) => a.severity === "warning").length;
  const generatedAt = "2026-11-04T06:55:00Z";
  return {
    schema_version: "1.0",
    report: {
      id: `rpt_${host}_20261104`,
      type: "daily",
      generated_at: generatedAt,
      period_start: "2026-11-03T06:55:00Z",
      period_end: generatedAt,
      collector_version: "1.0.3",
    },
    server: {
      hostname: host,
      client: summary.client,
      env: summary.env,
      cores: spec.hw.cores,
      ram_total_mb: ramTotalMb,
      disk_total_gb: spec.hw.diskGb,
      os: spec.hw.os,
      kernel: spec.hw.kernel,
      // RFC 5737 documentation range: never a real address.
      public_ip: `203.0.113.${10 + SAMPLE_FLEET.servers.findIndex((x) => x.hostname === host)}`,
      uptime_seconds: Math.round(spec.uptimeDays * 86400),
      last_heartbeat_at: summary.lastSeenAt,
    },
    status: { overall: nCrit ? "critical" : nWarn ? "warning" : "healthy", critical: nCrit, warning: nWarn, info: 0 },
    kpis: {
      cpu_avg_pct: round1(cpu.reduce((a, b) => a + b, 0) / cpu.length),
      cpu_peak_pct: cpu[peakIdx],
      cpu_peak_at: hAgo(23 - peakIdx + 0.4),
      cpu_hourly_pct: cpu,
      ram_hourly_pct: ram,
      disk_hourly_pct: disk,
      ram_used_mb: Math.round((ramTotalMb * ramNow) / 100),
      ram_peak_pct: Math.max(...ram),
      disk_used_pct: diskNow,
      disk_used_gb: round1((spec.hw.diskGb * diskNow) / 100),
      disk_days_until_full: spec.diskDaysUntilFull,
    },
    attention,
    changes: spec.changes ?? [],
    blocks: spec.blocks,
    hub_status: summary.status,
    sample: true,
  };
}

const UBUNTU = { os: "Ubuntu 24.04.3 LTS", kernel: "6.8.0-85-generic" };
const DEBIAN = { os: "Debian 12.12", kernel: "6.1.0-40-amd64" };

const SPECS: Record<string, DetailSpec> = {
  "core-01": {
    hw: { cores: 8, ramGb: 32, diskGb: 320, ...UBUNTU },
    uptimeDays: 63.4,
    cpuSpike: { hoursAgo: 5, value: 72 },
    diskGrowthPct24h: 0.4,
    diskDaysUntilFull: null,
    attention: [
      crit("ports.public_database", "Postgres ports 5432 and 6543 are open to the internet", "The firewall is off, so anyone can try passwords against the Supabase database.", "Bind supabase-pooler to 127.0.0.1 in docker-compose, then enable ufw."),
      warn("security.firewall", "Firewall is inactive", "Every port a container publishes is reachable from the internet.", "Enable ufw with allow rules for 22, 80 and 443 only."),
      warn("containers.unpinned", "2 n8n containers run the \"latest\" image", "A recreate can upgrade n8n silently and break workflows.", "Pin n8n-ops and n8n-sales to 1.112.3, the version that runs today."),
      warn("containers.no_memory_limit", "3 n8n containers have no memory limit", "One runaway workflow can take all 32 GB RAM and stall Supabase.", "Set mem_limit: 2g on n8n-ops, n8n-sales and n8n-support."),
      warn("n8n.failed_executions", "n8n-ops: 27 failed executions in 24h", "The invoice sync workflow fails every hour since 03:00.", "Open the last failed execution of \"Invoice sync\" in n8n-ops."),
    ],
    changes: [
      change("image_changed", "n8n-main", "1.111.0", "1.112.3", 4.2),
      change("port_opened", "supabase-pooler", null, "6543", 9.5),
      change("container_added", "siglip2", null, "pixtaha/siglip2:0.4.1", 15),
      change("config_changed", "nginx", null, null, 21),
    ],
    blocks: {
      containers: containers(
        [
          c("supabase-pooler", "supabase/supavisor", "2.5.7", 0.4, 140, 512, [port(5432, true), port(6543, true)], { status: "critical", issue: "Ports 5432 and 6543 published on 0.0.0.0" }),
          c("n8n-ops", "n8nio/n8n", "latest", 4.8, 1210, null, [port(5679)], { status: "warning" }),
          c("n8n-sales", "n8nio/n8n", "latest", 1.2, 640, null, [port(5680)], { status: "warning" }),
          c("n8n-support", "n8nio/n8n", "1.112.3", 0.9, 520, null, [port(5681)], { status: "warning" }),
        ],
        { total: 21, running: 21, unpinned: 2, noLimit: 3 },
      ),
      n8n: {
        instances: [
          n8n("n8n-main", "1.112.3", [22, 31], [4120, 2], { db_type: "postgresdb", db_size_mb: 860, telegram_webhooks: [{ bot: "ops_alerts_bot", ok: true }] }),
          n8n("n8n-ops", "1.112.3", [17, 20], [2210, 27], { pinned: false, mem_limit_mb: null, status: "warning" }),
          n8n("n8n-sales", "1.112.3", [8, 12], [690, 0], { pinned: false, mem_limit_mb: null }),
          n8n("n8n-support", "1.112.3", [6, 6], [412, 1], { mem_limit_mb: null, telegram_webhooks: [{ bot: "support_desk_bot", ok: true }] }),
          n8n("n8n-lab", "1.112.3", [3, 14], [88, 0], { db_size_mb: 64 }),
        ],
      },
      services: [
        svc("siglip2", "model", { port: 8090, latency_ms: 210, user: "app" }),
        svc("nginx", "systemd", { port: 443, public: true, user: "root" }),
        svc("docker", "systemd", { user: "root" }),
      ],
      scripts: [script("image-tagger.py", "python", "*/15 * * * *", 0.1, 41), script("weekly-digest.py", "python", "0 6 * * 1", 46, 128)],
      systemd_units: { running: 38, failed: 0 },
      databases: [db("supabase", "Supabase", "Postgres 15.8", 5120, 42, [61, 200], 5.5), db("n8n-main", "Postgres", "16.4", 860, 9, [12, 100], 5.5)],
      domains: [dom("app.core.example", 61), dom("n8n.core.example", 61), dom("supabase.core.example", 61)],
      security: security({ firewall_active: false, failed_logins_24h: 3412, pending_security_updates: 9, public_ports: [...WEB_PORTS("nginx"), pp(5432, "supabase-pooler", true), pp(6543, "supabase-pooler", true)] }),
      backups: [backup("supabase-pg-dump", "job", 5.5, 1840), backup("n8n-main-pg-dump", "job", 5.5, 212), backup("/srv/backups/n8n-sqlite", "folder", 5.6, 96)],
    },
  },

  "nilehub-api": {
    hw: { cores: 4, ramGb: 8, diskGb: 160, ...UBUNTU },
    uptimeDays: 12.2,
    cpuSpike: { hoursAgo: 2, value: 97 },
    ramSpike: { hoursAgo: 2, value: 99 },
    diskGrowthPct24h: 0.6,
    diskDaysUntilFull: 210,
    attention: [
      crit("containers.oom", "api-worker was killed 3 times by OOM in 24h", "Shipment status updates stop for 2 to 4 minutes each time; customers see stale tracking.", "Raise api-worker mem_limit from 512 MB to 1 GB, or cap the batch size."),
      warn("host.ram", "RAM peaked at 99% with swap in use", "All containers slow down when the host swaps.", "Add 4 GB RAM or move Redis to its own server."),
    ],
    changes: [change("image_changed", "api-orders", "2.14.0", "2.15.1", 7), change("reboot", "host", null, null, 293)],
    blocks: {
      containers: containers([
        c("api-orders", "nilehub/api-orders", "2.15.1", 18.2, 690, 1024, [port(8001)]),
        c("api-tracking", "nilehub/api-tracking", "2.9.4", 21.4, 820, 1024, [port(8002)]),
        c("api-billing", "nilehub/api-billing", "1.22.0", 6.1, 410, 1024, [port(8003)]),
        c("api-worker", "nilehub/api-worker", "2.15.1", 0, 0, 512, [], { state: "restarting", status: "critical", restarts_24h: 5, oom_kills_24h: 3 }),
        c("postgres", "postgres", "16.4", 14.8, 2240, 3072, [port(5432)]),
        c("redis", "redis", "7.4.1", 3.2, 1460, 2048, [port(6379)]),
        c("nginx", "nginx", "1.27.2-alpine", 1.1, 38, 256, [port(80, true), port(443, true)]),
        c("celery-beat", "nilehub/api-worker", "2.15.1", 0.3, 120, 256),
      ]),
      services: [svc("api-orders", "api", { port: 8001, latency_ms: 140 }), svc("api-tracking", "api", { port: 8002, latency_ms: 380 }), svc("api-billing", "api", { port: 8003, latency_ms: 95 })],
      systemd_units: { running: 27, failed: 0 },
      databases: [db("nilehub", "Postgres", "16.4", 18400, 220, [88, 150], 4), db("cache", "Redis", "7.4.1", 1460, 30, [42, 10000], null, { status: "info" })],
      domains: [dom("api.nilehub.example", 44), dom("track.nilehub.example", 44)],
      security: security({ failed_logins_24h: 640, public_ports: WEB_PORTS("nginx") }),
      backups: [backup("nilehub-pg-dump", "job", 4, 3920)],
    },
  },

  "lens-studio": {
    hw: { cores: 4, ramGb: 16, diskGb: 160, ...UBUNTU },
    uptimeDays: 41.3,
    cpuSpike: { hoursAgo: 7, value: 41 },
    diskGrowthPct24h: 0.2,
    diskDaysUntilFull: 380,
    attention: [
      warn("security.firewall", "Firewall is inactive", "Every port a container publishes is reachable from the internet. Today all app ports bind to 127.0.0.1, so nothing is exposed yet.", "Enable ufw with allow rules for 22, 80 and 443 only."),
      warn("containers.unpinned", "rembg runs the \"latest\" image", "A pull or recreate can upgrade it silently and change cut-out quality.", "Pin danielgatis/rembg to the version that runs today (2.0.67)."),
      warn("containers.no_memory_limit", "n8n has no memory limit", "A runaway workflow can take all 16 GB RAM and stall Supabase.", "Set mem_limit: 2g on the n8n service in docker-compose."),
      warn("domains.cert", "TLS for api.lens-studio.example expires in 18 days", "Renewal was skipped at 30 days; clients see a browser warning once it expires.", "Check the certbot timer and the /.well-known route for this site in nginx."),
    ],
    changes: [
      change("image_changed", "lens-api", "1.8.2", "1.9.0", 5.1),
      change("config_changed", "nginx", null, null, 19.6),
      change("container_added", "rembg", null, "danielgatis/rembg:latest", 22.4),
    ],
    blocks: {
      containers: containers([
        ...supabaseStack("supabase"),
        c("n8n", "n8nio/n8n", "1.112.3", 1.6, 610, null, [port(5678)], { status: "warning" }),
        c("rembg", "danielgatis/rembg", "latest", 2.8, 1340, 3072, [port(7000)], { status: "warning" }),
        c("lens-api", "lensstudio/lens-api", "1.9.0", 0.9, 220, 1024, [port(8080)]),
      ]),
      n8n: {
        instances: [n8n("n8n", "1.112.3", [14, 18], [1982, 3], { mem_limit_mb: null, db_size_mb: 412, db_growth_mb_24h: 6, telegram_webhooks: [{ bot: "lens_orders_bot", ok: true }] })],
      },
      services: [
        svc("nginx", "systemd", { port: 443, public: true, user: "root" }),
        svc("lens-api", "api", { port: 8080, latency_ms: 84, user: "app" }),
        svc("rembg", "model", { port: 7000, latency_ms: 1420 }),
      ],
      scripts: [script("nightly-thumbnails.py", "python", "0 0 * * *", 9.2, 312), script("pg-backup.sh", "shell", "30 1 * * *", 7.7, 48)],
      systemd_units: { running: 31, failed: 0 },
      databases: [db("supabase", "Supabase", "Postgres 15.8", 2340, 18, [34, 100], 7.7), db("n8n", "SQLite", "3.45", 412, 6, null, 7.7)],
      domains: [dom("lens-studio.example", 74), dom("api.lens-studio.example", 18), dom("studio.lens-studio.example", 74), dom("n8n.lens-studio.example", 74)],
      security: security({ firewall_active: false, failed_logins_24h: 1284, pending_security_updates: 6 }),
      backups: [backup("supabase-pg-dump", "job", 7.7, 612), backup("/srv/backups/n8n", "folder", 7.7, 138)],
    },
  },

  "souq-sahel-web": {
    hw: { cores: 4, ramGb: 8, diskGb: 80, ...UBUNTU },
    uptimeDays: 88.1,
    diskGrowthPct24h: 1.1,
    diskDaysUntilFull: 11,
    attention: [warn("host.disk", "Disk is 87% full, about 11 days until full", "Supabase storage grows about 0.9 GB a day from product photos.", "Move storage to object storage, or grow the disk to 160 GB.")],
    changes: [change("image_changed", "storefront", "3.4.0", "3.4.1", 15.3)],
    blocks: {
      containers: containers([c("storefront", "souqsahel/storefront", "3.4.1", 6.2, 380, 1024, [port(3001)]), ...supabaseStack("supabase").slice(0, 11)]),
      services: [svc("caddy", "systemd", { port: 443, public: true, user: "caddy" })],
      systemd_units: { running: 29, failed: 0 },
      databases: [db("supabase", "Supabase", "Postgres 15.8", 3620, 64, [22, 100], 6.2)],
      domains: [dom("souqsahel.example", 52, { server: "caddy" }), dom("www.souqsahel.example", 52, { server: "caddy" }), dom("admin.souqsahel.example", 52, { server: "caddy" })],
      security: security({ failed_logins_24h: 210, public_ports: WEB_PORTS("caddy") }),
      backups: [backup("supabase-pg-dump", "job", 6.2, 902)],
    },
  },

  "dentaplus-crm": {
    hw: { cores: 2, ramGb: 4, diskGb: 60, ...DEBIAN },
    uptimeDays: 23.6,
    last: { cpu: 11, ram: 49, disk: 36 },
    diskGrowthPct24h: 0.2,
    diskDaysUntilFull: null,
    blocks: {
      containers: containers([
        c("n8n-booking", "n8nio/n8n", "1.110.1", 2.1, 420, 1024, [port(5678)]),
        c("n8n-reminders", "n8nio/n8n", "1.110.1", 0.8, 300, 1024, [port(5679)]),
        c("postgres", "postgres", "15.10", 1.9, 310, 1024, [port(5432)]),
      ]),
      n8n: {
        instances: [
          n8n("n8n-booking", "1.110.1", [9, 11], [740, 0], { db_type: "postgresdb", db_size_mb: 220, telegram_webhooks: [{ bot: "dentaplus_booking_bot", ok: true }] }),
          n8n("n8n-reminders", "1.110.1", [4, 4], [310, 0], { db_type: "postgresdb", db_size_mb: 90 }),
        ],
      },
      databases: [db("crm", "Postgres", "15.10", 1240, 8, [14, 100], 6.4)],
      domains: [dom("book.dentaplus.example", 33)],
      security: security({ failed_logins_24h: 96 }),
      backups: [backup("crm-pg-dump", "job", 6.4, 182)],
    },
  },

  "flows-platform": {
    hw: { cores: 16, ramGb: 64, diskGb: 500, ...UBUNTU },
    uptimeDays: 104.8,
    diskGrowthPct24h: 0.3,
    diskDaysUntilFull: null,
    changes: [change("image_changed", "web", "5.2.0", "5.3.0", 11)],
    blocks: {
      containers: containers([], { total: 38, running: 38, unpinned: 0, noLimit: 0 }),
      n8n: {
        instances: Array.from({ length: 33 }, (_, i) =>
          n8n(`n8n-cohort-${String(i + 1).padStart(2, "0")}`, "1.112.3", [6 + (i % 5), 9 + (i % 5)], [180 + ((i * 37) % 240), 0], { db_type: "postgresdb", db_size_mb: 120 + i * 3 }),
        ),
      },
      services: [svc("web", "api", { port: 3000, latency_ms: 120 }), svc("caddy", "systemd", { port: 443, public: true, user: "caddy" })],
      systemd_units: { running: 44, failed: 0 },
      databases: [db("platform", "Postgres", "16.4", 22800, 140, [120, 300], 5), db("queue", "Redis", "7.4.1", 820, 2, [210, 10000], null, { status: "info" })],
      domains: [dom("flows.example", 70, { server: "caddy" }), dom("app.flows.example", 70, { server: "caddy" }), dom("hooks.flows.example", 70, { server: "caddy" })],
      security: security({ failed_logins_24h: 2105, public_ports: WEB_PORTS("caddy") }),
      backups: [backup("platform-pg-dump", "job", 5, 6420), backup("/srv/backups/n8n", "folder", 5.1, 2310)],
    },
  },

  "facility-ops": {
    hw: { cores: 2, ramGb: 8, diskGb: 120, ...UBUNTU },
    uptimeDays: 57,
    diskGrowthPct24h: 0.1,
    diskDaysUntilFull: null,
    blocks: {
      containers: containers([
        c("n8n", "n8nio/n8n", "1.112.3", 1.4, 520, 2048, [port(5678)]),
        c("n8n-worker-1", "n8nio/n8n", "1.112.3", 0.6, 340, 1024),
        c("n8n-worker-2", "n8nio/n8n", "1.112.3", 0.5, 330, 1024),
        c("postgres", "postgres", "16.4", 1.2, 410, 2048, [port(5432)]),
        c("redis", "redis", "7.4.1", 0.3, 40, 256, [port(6379)]),
        c("caddy", "caddy", "2.8.4", 0.1, 22, 128, [port(80, true), port(443, true)]),
        c("minio", "minio/minio", "RELEASE.2025-09-07T16-13-09Z", 0.2, 180, 1024, [port(9000)]),
        c("metabase", "metabase/metabase", "v0.56.4", 0.9, 780, 1536, [port(3000)]),
        c("pg-backup", "prodrigestivill/postgres-backup-local", "16", 0, 12, 128),
      ]),
      n8n: { instances: [n8n("n8n", "1.112.3", [21, 24], [3104, 0], { db_type: "postgresdb", db_size_mb: 540 })] },
      databases: [db("facility", "Postgres", "16.4", 2900, 12, [18, 100], 3)],
      domains: [dom("ops.deltafacility.example", 66, { server: "caddy" })],
      security: security({ failed_logins_24h: 58, public_ports: WEB_PORTS("caddy") }),
      backups: [backup("pg-backup container", "job", 3, 410)],
    },
  },

  "redsea-tours": {
    hw: { cores: 2, ramGb: 4, diskGb: 80, ...UBUNTU },
    uptimeDays: 33.5,
    diskGrowthPct24h: 0.2,
    diskDaysUntilFull: null,
    blocks: {
      containers: containers([
        c("n8n-bookings", "n8nio/n8n", "1.111.0", 0.9, 330, 768, [port(5678)]),
        c("n8n-crm", "n8nio/n8n", "1.111.0", 0.4, 260, 768, [port(5679)]),
        c("n8n-ops", "n8nio/n8n", "1.111.0", 0.3, 240, 768, [port(5680)]),
        c("web", "redsea/web", "2.0.6", 2.2, 210, 512, [port(3000)]),
        c("caddy", "caddy", "2.8.4", 0.1, 20, 128, [port(80, true), port(443, true)]),
        c("redis", "redis", "7.4.1", 0.1, 12, 128, [port(6379)]),
      ]),
      n8n: {
        instances: [
          n8n("n8n-bookings", "1.111.0", [11, 12], [920, 1], { telegram_webhooks: [{ bot: "redsea_booking_bot", ok: true }] }),
          n8n("n8n-crm", "1.111.0", [5, 7], [210, 0]),
          n8n("n8n-ops", "1.111.0", [4, 4], [96, 0]),
        ],
      },
      domains: [dom("redsea-tours.example", 49, { server: "caddy" }), dom("book.redsea-tours.example", 49, { server: "caddy" })],
      security: security({ failed_logins_24h: 402, public_ports: WEB_PORTS("caddy") }),
      backups: [backup("/srv/backups/n8n", "folder", 6, 74)],
    },
  },

  "greenleaf-ml": {
    hw: { cores: 8, ramGb: 32, diskGb: 250, ...UBUNTU },
    uptimeDays: 19.2,
    cpuSpike: { hoursAgo: 6, value: 91 },
    diskGrowthPct24h: 0.5,
    diskDaysUntilFull: 180,
    blocks: {
      containers: containers([
        c("model-service", "greenleaf/model-service", "0.9.2", 31.5, 9400, 16384, [port(8500)]),
        c("ingest", "greenleaf/pipelines", "0.9.2", 4.1, 820, 2048),
        c("forecast", "greenleaf/pipelines", "0.9.2", 6.8, 2100, 4096),
        c("report-builder", "greenleaf/pipelines", "0.9.2", 1.0, 360, 1024),
      ]),
      services: [svc("model-service", "model", { port: 8500, latency_ms: 260 })],
      scripts: [script("retrain.py", "python", "0 1 * * *", 8.2, 2840), script("sync-sensors.py", "python", "*/10 * * * *", 0.05, 22)],
      systemd_units: { running: 24, failed: 0 },
      security: security({ failed_logins_24h: 77, public_ports: WEB_PORTS("nginx") }),
      domains: [dom("ml.greenleaf.example", 58)],
      backups: [backup("/srv/models", "folder", 8.1, 14200)],
    },
  },

  "delta-legal-demo": {
    hw: { cores: 2, ramGb: 4, diskGb: 40, ...DEBIAN },
    uptimeDays: 9.7,
    diskGrowthPct24h: 0.1,
    diskDaysUntilFull: null,
    blocks: {
      containers: containers([
        c("n8n-intake", "n8nio/n8n", "1.112.3", 0.4, 260, 768, [port(5678)]),
        c("n8n-docs", "n8nio/n8n", "1.112.3", 0.2, 210, 768, [port(5679)]),
        c("n8n-notify", "n8nio/n8n", "1.112.3", 0.1, 190, 768, [port(5680)]),
      ]),
      n8n: { instances: [n8n("n8n-intake", "1.112.3", [4, 5], [64, 0]), n8n("n8n-docs", "1.112.3", [3, 3], [21, 0]), n8n("n8n-notify", "1.112.3", [2, 2], [40, 0])] },
      domains: [dom("demo.deltalegal.example", 80, { server: "caddy" })],
      security: security({ failed_logins_24h: 31, public_ports: WEB_PORTS("caddy") }),
    },
  },

  "cairo-print-shop": {
    hw: { cores: 1, ramGb: 2, diskGb: 40, ...DEBIAN },
    uptimeDays: 140.2,
    diskGrowthPct24h: 0.05,
    diskDaysUntilFull: null,
    blocks: {
      containers: containers([c("print-api", "cairoprint/print-api", "0.6.1", 0.6, 120, 512, [port(5000)]), c("caddy", "caddy", "2.8.4", 0.1, 18, 128, [port(80, true), port(443, true)])]),
      services: [svc("print-api", "api", { port: 5000, latency_ms: 46 })],
      databases: [db("orders", "SQLite", "3.40", 38, 0.4, null, 22)],
      domains: [dom("demo.cairoprint.example", 39, { server: "caddy" })],
      security: security({ failed_logins_24h: 12, public_ports: WEB_PORTS("caddy") }),
      backups: [backup("/srv/backups/orders", "folder", 22, 9)],
    },
  },

  "mansoura-dev": {
    hw: { cores: 4, ramGb: 8, diskGb: 120, ...UBUNTU },
    uptimeDays: 2.4,
    diskGrowthPct24h: 0.8,
    diskDaysUntilFull: null,
    changes: [change("reboot", "host", null, null, 57.6), change("container_added", "supabase-kong", null, "kong:2.8.1", 30)],
    blocks: {
      containers: containers(supabaseStack("supabase", { lite: true })),
      scripts: [
        script("scrape-courses.py", "python", "0 */6 * * *", 3.2, 410),
        script("transcribe.py", "python", null, 26, 1820),
        script("eval-prompts.py", "python", null, 30, 640),
        script("seed-dev-db.py", "python", null, 31, 18),
      ],
      databases: [db("supabase", "Supabase", "Postgres 15.8", 640, 22, [9, 100], null, { status: "info" })],
      security: security({ failed_logins_24h: 5 }),
    },
  },
};

/** Detail per hostname, built from the fleet row so both screens agree. */
export const SAMPLE_DETAILS: Record<string, ServerDetail> = Object.fromEntries(
  SAMPLE_FLEET.servers.filter((x) => SPECS[x.hostname]).map((x) => [x.hostname, detail(x, SPECS[x.hostname])]),
);
