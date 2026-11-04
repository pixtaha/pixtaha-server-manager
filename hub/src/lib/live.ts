import "server-only";
import { CHECKS, checkFor } from "./checks";
import type { AlertItem, AlertsSnapshot, Env, FleetSnapshot, ReportListItem, ServerDetail, ServerSummary, Severity, Status } from "./types";

/**
 * Live data from the self-hosted Supabase (schema server_manager), read server-side through the
 * service-role-only RPC functions public.sm_fleet() and public.sm_server(hostname).
 */

/** A server with no report for this long shows as offline (daily report + margin). */
const OFFLINE_AFTER_MS = 26 * 3600 * 1000;

interface FleetRow {
  hostname: string;
  client: string;
  env: Env;
  last_report_at: string | null;
  last_status: Severity | null;
  open_issues: number;
  payload: Payload | null;
}

interface IssueRow {
  key: string;
  check_id: string;
  severity: Severity;
  title: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
}

interface ServerRow extends FleetRow {
  issues: IssueRow[];
}

// Payloads come from collectors of different versions; read defensively.
type Payload = Omit<ServerDetail, "hub_status" | "sample"> & Record<string, unknown>;

export function liveConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const url = `${process.env.SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/rpc/${fn}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${fn} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function toStatus(sev: Severity | null | undefined): Status {
  if (sev === "critical" || sev === "warning" || sev === "offline") return sev;
  if (sev === "unknown") return "offline";
  return "healthy";
}

function hubStatus(row: FleetRow, now: number): Status {
  if (!row.last_report_at || now - Date.parse(row.last_report_at) > OFFLINE_AFTER_MS) return "offline";
  return toStatus(row.payload?.status?.overall ?? row.last_status);
}

function pct(part: number | null | undefined, total: number | null | undefined): number | null {
  if (part == null || !total) return null;
  return Math.round((100 * part) / total);
}

function workloads(p: Payload): string[] {
  const out: string[] = [];
  const b = p.blocks ?? {};
  const n8n = b.n8n?.instances?.length ?? 0;
  if (n8n) out.push(`${n8n} n8n`);
  const engines = new Set((b.databases ?? []).map((d) => d.engine).filter((e) => e !== "SQLite"));
  for (const e of ["Supabase", "Postgres", "MySQL", "Redis"] as const) if (engines.has(e)) out.push(e);
  const names = (b.containers?.items ?? []).map((c) => `${c.name} ${c.image}`.toLowerCase()).join(" ");
  if (names.includes("siglip")) out.push("siglip2");
  if (names.includes("rembg")) out.push("rembg");
  if (names.includes("evolution")) out.push("Evolution API");
  if (names.includes("gotenberg")) out.push("Gotenberg");
  const apis = (b.services ?? []).filter((s) => s.kind === "api").length;
  if (apis) out.push(apis > 1 ? `API ×${apis}` : "API");
  return out.slice(0, 5);
}

// Older payloads (discovery runs) use null where the UI expects arrays.
function normalizeKpis(k: Payload["kpis"]): Payload["kpis"] {
  const arr = (v: unknown) => (Array.isArray(v) ? (v as (number | null)[]) : undefined);
  return {
    ...k,
    cpu_hourly_pct: arr(k?.cpu_hourly_pct) ?? Array.from({ length: 24 }, () => null),
    ram_hourly_pct: arr(k?.ram_hourly_pct),
    disk_hourly_pct: arr(k?.disk_hourly_pct),
  };
}

function normalizeBlocks(b: Payload["blocks"]): Payload["blocks"] {
  const out = { ...b };
  if (out.containers) out.containers = { ...out.containers, items: (out.containers.items ?? []).map((c) => ({ ...c, ports: c.ports ?? [] })) };
  if (out.n8n) out.n8n = { instances: (out.n8n.instances ?? []).map((i) => ({ ...i, telegram_webhooks: i.telegram_webhooks ?? [] })) };
  if (out.security) out.security = { ...out.security, public_ports: out.security.public_ports ?? [], unknown_login_ips: out.security.unknown_login_ips ?? [] };
  for (const k of ["scripts", "services", "databases", "domains", "backups"] as const) {
    if (out[k] != null && !Array.isArray(out[k])) delete out[k];
  }
  return out;
}

function attentionId(a: Record<string, unknown>): string {
  return String(a.id ?? a.check ?? a.key ?? "unknown");
}

function summarize(row: FleetRow, now: number): ServerSummary {
  const p = row.payload;
  const status = hubStatus(row, now);
  const att = (p?.attention ?? []) as unknown as Record<string, unknown>[];
  const top = att[0];
  const note =
    status === "offline"
      ? row.last_report_at
        ? "No report in the last 26 hours"
        : "Waiting for the first report"
      : top
        ? (CHECKS[attentionId(top)]?.name ?? String(top.title ?? attentionId(top)))
        : "All checks passed";
  const count = (sev: string) => att.filter((a) => a.severity === sev).length;
  return {
    hostname: row.hostname,
    client: row.client,
    env: row.env,
    status,
    note,
    cpuPct: p?.kpis?.cpu_avg_pct != null ? Math.round(p.kpis.cpu_avg_pct) : null,
    ramPct: pct(p?.kpis?.ram_used_mb, p?.server?.ram_total_mb),
    diskPct: p?.kpis?.disk_used_pct != null ? Math.round(p.kpis.disk_used_pct) : null,
    workloads: p ? workloads(p) : [],
    alertsCritical: count("critical"),
    alertsWarning: count("warning"),
    containersUp: p?.blocks?.containers?.running ?? 0,
    containersTotal: p?.blocks?.containers?.total ?? 0,
    lastSeenAt: row.last_report_at ?? new Date(0).toISOString(),
  };
}

export async function liveFleet(): Promise<FleetSnapshot> {
  const now = Date.now();
  const rows = await rpc<FleetRow[]>("sm_fleet");
  return { generatedAt: new Date(now).toISOString(), sample: false, servers: rows.map((r) => summarize(r, now)) };
}

/** Payload v1 as stored -> the shape the Server detail view renders. */
function toDetail(p: Payload, heartbeatAt: string, status: Status): ServerDetail {
  const attention = ((p.attention ?? []) as unknown as Record<string, unknown>[]).map((a) => ({
    id: attentionId(a),
    severity: (a.severity as Severity) ?? "warning",
    title: String(a.title ?? ""),
    impact: String(a.impact ?? ""),
    action: String(a.action ?? ""),
  }));
  return {
    ...p,
    kpis: normalizeKpis(p.kpis),
    attention,
    changes: p.changes ?? [],
    blocks: normalizeBlocks(p.blocks ?? {}),
    server: { ...p.server, last_heartbeat_at: heartbeatAt },
    hub_status: status,
  };
}

export async function liveServer(hostname: string): Promise<ServerDetail | null> {
  const row = await rpc<ServerRow | null>("sm_server", { p_hostname: hostname });
  if (!row || !row.payload) return null;
  return toDetail(row.payload, row.last_report_at ?? row.payload.report.generated_at, hubStatus(row, Date.now()));
}

export async function liveReports(limit = 300): Promise<ReportListItem[]> {
  const rows = await rpc<(Omit<ReportListItem, "status"> & { status: Severity })[]>("sm_reports", { p_limit: limit });
  return rows.map((r) => ({ ...r, status: toStatus(r.status) }));
}

/** One stored report, rendered as it was when it arrived (status from the report itself). */
export async function liveReport(id: string): Promise<{ item: ReportListItem; detail: ServerDetail } | null> {
  const r = await rpc<{ id: string; hostname: string; client: string; env: Env; generated_at: string; received_at: string; payload: Payload } | null>("sm_report", { p_id: id });
  if (!r || !r.payload) return null;
  const status = toStatus(r.payload.status?.overall);
  const att = (r.payload.attention ?? []) as unknown as Record<string, unknown>[];
  return {
    item: {
      id: r.id, hostname: r.hostname, client: r.client, env: r.env, type: r.payload.report?.type ?? "daily",
      generated_at: r.generated_at, received_at: r.received_at, status,
      critical: att.filter((a) => a.severity === "critical").length, warning: att.filter((a) => a.severity === "warning").length,
    },
    detail: toDetail(r.payload, r.generated_at, status),
  };
}

export async function liveAlerts(): Promise<AlertsSnapshot> {
  const fleet = await rpc<FleetRow[]>("sm_fleet");
  const servers = await Promise.all(fleet.map((f) => rpc<ServerRow | null>("sm_server", { p_hostname: f.hostname })));
  const now = Date.now();
  const alerts: AlertItem[] = [];
  const checks = { ...CHECKS };
  for (const s of servers) {
    if (!s) continue;
    if (hubStatus(s, now) === "offline") {
      alerts.push({
        id: `${s.hostname}|agent.heartbeat`, check_id: "agent.heartbeat", severity: "offline", hostname: s.hostname,
        detail: s.last_report_at ? "No report in the last 26 hours" : "Waiting for the first report",
        first_seen_at: s.last_report_at ?? new Date(now).toISOString(), last_seen_at: new Date(now).toISOString(),
        occurrences: 1, state: "open",
      });
    }
    for (const i of s.issues) {
      checks[i.check_id] = checkFor(i.check_id);
      const days = Math.round((Date.parse(i.last_seen_at) - Date.parse(i.first_seen_at)) / 86400000);
      alerts.push({
        id: `${s.hostname}|${i.key}`,
        check_id: i.check_id,
        severity: toStatus(i.severity),
        hostname: s.hostname,
        detail: i.title,
        first_seen_at: i.first_seen_at,
        last_seen_at: i.last_seen_at,
        occurrences: Math.max(1, days + 1),
        state: i.resolved_at ? "resolved" : i.acknowledged_at ? "acknowledged" : "open",
        ...(i.acknowledged_at ? { acknowledged_at: i.acknowledged_at } : {}),
        ...(i.resolved_at ? { resolved_at: i.resolved_at } : {}),
      });
    }
  }
  return { generatedAt: new Date(now).toISOString(), sample: false, checks, alerts };
}
