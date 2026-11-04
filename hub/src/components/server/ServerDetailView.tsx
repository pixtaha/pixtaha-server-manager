import { AlertTriangle, Globe, Lock, Pin } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusIcon, StatusPill, sevStatus } from "@/components/StatusPill";
import { ago, cairoDay, cairoTime, cairoWhen, dur, mb, ms, num, uptime } from "@/lib/format";
import type { AttentionItem, ChangeItem, ContainerItem, DatabaseItem, DomainItem, N8nInstance, ServerDetail, Severity, Status } from "@/lib/types";
import { ResourceChart } from "./ResourceChart";

const RANK: Record<Severity, number> = { critical: 0, warning: 1, offline: 2, unknown: 3, info: 4, healthy: 5 };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const sevColor = (s: Status | null) => (s === "critical" ? "var(--color-critical)" : s === "warning" ? "var(--color-warning)" : s === "offline" ? "var(--color-offline)" : undefined);

/* ------------------------------------------------------------------ */
/* small building blocks                                               */
/* ------------------------------------------------------------------ */

function Section({ title, meta, children, id }: { title: string; meta?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <header className="panel-head">
        <h2 id={id} className="panel-title">{title}</h2>
        {meta ? <span className="panel-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

type Tone = "neutral" | "warning" | "critical" | "muted";
function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon}
      {children}
    </span>
  );
}

/** Inline status text: icon + label, coloured by status. Never colour alone. */
function StatusText({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className="stext" style={{ color: sevColor(status) }}>
      <StatusIcon status={status} size={14} />
      {children}
    </span>
  );
}

interface Col<T> {
  label: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** On mobile the cell spans the full card width. */
  wide?: boolean;
}

/** Table on desktop; at 900px and below each row becomes a labelled card (see .dtable in app.css). */
function DataTable<T>({ label, cols, rows, rowKey }: { label: string; cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string }) {
  return (
    <div className="dtable-wrap">
      <table className="dtable" aria-label={label}>
        <thead>
          <tr>{cols.map((c) => <th key={c.label} scope="col" className={c.className}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {cols.map((c, i) => (
                <td key={c.label} data-label={c.label} className={`${i === 0 ? "dt-primary " : ""}${c.wide ? "dt-wide " : ""}${c.className ?? ""}`}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Meter({ pct, status }: { pct: number; status: Status | null }) {
  return (
    <div className="bar-track" aria-hidden>
      <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: sevColor(status) ?? "var(--color-text-subtle)" }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export function ServerDetailView({ d, now }: { d: ServerDetail; now: string }) {
  const { server: s, kpis: k, blocks: b, report } = d;
  const status = d.hub_status;
  const attention = [...d.attention].sort((a, z) => RANK[a.severity] - RANK[z.severity]);
  const ref = report.generated_at;
  const specs = [`${s.cores} cores`, `${Math.round(s.ram_total_mb / 1024)} GB RAM`, `${s.disk_total_gb} GB disk`, s.os];
  const allRunning = !b.containers || b.containers.running === b.containers.total;

  const nCrit = attention.filter((a) => a.severity === "critical").length;
  const nWarn = attention.filter((a) => a.severity === "warning").length;
  const statusLine =
    status === "offline"
      ? `No heartbeat for ${ago(s.last_heartbeat_at, now).replace(" ago", "")}. Showing the last report.`
      : nCrit
        ? `${plural(nCrit, "critical issue")}${nWarn ? ` and ${plural(nWarn, "warning")}` : ""}.`
        : attention.length
          ? `${plural(attention.length, "item")} need${attention.length === 1 ? "s" : ""} attention.${allRunning ? " Everything is running." : ""}`
          : "All checks passed.";

  return (
    <div className="stack detail">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link href="/">Fleet</Link>
        <span aria-hidden>/</span>
        <span dir="ltr" aria-current="page">{s.hostname}</span>
      </nav>

      {/* ---------- health header ---------- */}
      <header className="health">
        <div className="health-top">
          <h1 dir="ltr" className="page-title health-host">{s.hostname}</h1>
          <StatusPill status={status} />
        </div>
        <Meta
          items={[
            <span key="c">{s.client}</span>,
            <span key="e" className="env">{s.env}</span>,
            ...specs.map((x) => <span key={x} dir="ltr" className="muted">{x}</span>),
          ]}
        />
        <Meta
          items={[
            <span key="u" className="muted">Up <span dir="ltr" className="ink">{uptime(s.uptime_seconds)}</span></span>,
            <span key="h" className="muted">Last heartbeat <span dir="ltr" style={{ color: status === "offline" ? "var(--color-offline)" : "var(--color-text)" }}>{ago(s.last_heartbeat_at, now)}</span></span>,
            <span key="r" className="muted">Report <span dir="ltr" className="ink">{cairoTime(ref)} Cairo</span></span>,
            <span key="a" dir="ltr" className="subtle">agent v{report.collector_version}</span>,
          ]}
        />
        <p className="health-line" style={{ color: sevColor(status) ?? "var(--color-text-muted)" }}>{statusLine}</p>
      </header>

      {/* ---------- KPI tiles ---------- */}
      <Kpis d={d} />

      {/* ---------- 24h charts ---------- */}
      <section aria-label="Resources, last 24 hours" className="charts">
        <ResourceChart
          title="CPU"
          values={k.cpu_hourly_pct}
          endIso={ref}
          threshold={90}
          current={k.cpu_hourly_pct.at(-1) == null ? "—" : `${k.cpu_hourly_pct.at(-1)}%`}
          summary={k.cpu_avg_pct == null ? "No data" : `Avg ${Math.round(k.cpu_avg_pct)}% · peak ${Math.round(k.cpu_peak_pct ?? 0)}%${k.cpu_peak_at ? ` at ${cairoTime(k.cpu_peak_at)}` : ""}`}
        />
        {k.ram_hourly_pct ? (
          <ResourceChart
            title="Memory"
            values={k.ram_hourly_pct}
            endIso={ref}
            threshold={90}
            current={k.ram_used_mb == null ? "—" : `${mb(k.ram_used_mb)} / ${mb(s.ram_total_mb)}`}
            summary={`Peak ${Math.round(Math.max(...k.ram_hourly_pct.filter((v): v is number => v != null)))}% of ${mb(s.ram_total_mb)}`}
          />
        ) : null}
        {k.disk_hourly_pct ? (
          <ResourceChart
            title="Disk"
            values={k.disk_hourly_pct}
            endIso={ref}
            threshold={80}
            current={k.disk_used_pct == null ? "—" : `${k.disk_used_pct}%`}
            summary={`${diskGrowth(k.disk_hourly_pct, s.disk_total_gb)} in 24h · ${s.disk_total_gb} GB total`}
          />
        ) : null}
      </section>

      {/* ---------- needs attention ---------- */}
      <Section title="Needs attention" id="sec-attention" meta={attention.length ? [nCrit ? `${nCrit} critical` : "", nWarn ? `${nWarn} warning` : ""].filter(Boolean).join(" · ") : "None"}>
        {attention.length ? (
          <ol className="attn">
            {attention.map((a) => <Attention key={a.id + a.title} a={a} />)}
          </ol>
        ) : (
          <div className="all-good">
            <StatusText status="healthy">Nothing needs attention. All checks passed.</StatusText>
          </div>
        )}
      </Section>

      {b.containers ? <Containers c={b.containers} /> : null}
      {b.n8n && b.n8n.instances.length ? <N8n instances={b.n8n.instances} /> : null}
      {(b.services && b.services.length) || (b.scripts && b.scripts.length) ? <Services d={d} /> : null}
      {b.databases && b.databases.length ? <Databases rows={b.databases} ref_={ref} /> : null}
      {b.domains && b.domains.length ? <Domains rows={b.domains} /> : null}

      <div className="split">
        {b.security ? <ExposedPorts d={d} /> : null}
        {b.security ? <Security d={d} /> : null}
      </div>

      <div className="split">
        {b.backups && b.backups.length ? <Backups d={d} /> : null}
        <Changes items={d.changes} ref_={ref} />
      </div>

      {d.sample ? <span className="foot-note">Sample data · fictional server. Real details appear here once the collector reports.</span> : null}
    </div>
  );
}

/** Meta line: the separator trails each item so a wrapped line never starts with "·". */
function Meta({ items }: { items: ReactNode[] }) {
  return (
    <div className="health-meta">
      {items.map((it, i) => (
        <span key={i} className="meta-item">
          {it}
          {i < items.length - 1 ? <span className="dot-sep" aria-hidden>·</span> : null}
        </span>
      ))}
    </div>
  );
}

function diskGrowth(values: (number | null)[], totalGb: number) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return "No trend";
  const gb = ((nums[nums.length - 1] - nums[0]) / 100) * totalGb;
  return `${gb >= 0 ? "+" : "−"}${Math.abs(gb).toFixed(1)} GB`;
}

/* ------------------------------------------------------------------ */
/* KPI tiles                                                           */
/* ------------------------------------------------------------------ */

function Kpis({ d }: { d: ServerDetail }) {
  const { server: s, kpis: k, report } = d;
  const since = new Date(Date.parse(report.generated_at) - s.uptime_seconds * 1000).toISOString();
  const ramPct = k.ram_used_mb == null ? null : Math.round((k.ram_used_mb / s.ram_total_mb) * 100);
  const ramStatus: Status | null = ramPct == null ? null : ramPct >= 95 ? "critical" : ramPct >= 85 ? "warning" : null;
  const days = k.disk_days_until_full;
  const diskStatus: Status | null =
    k.disk_used_pct == null ? null : k.disk_used_pct >= 90 || (days != null && days <= 3) ? "critical" : k.disk_used_pct >= 80 || (days != null && days <= 14) ? "warning" : null;
  const cpuStatus: Status | null = k.cpu_peak_pct != null && k.cpu_peak_pct >= 95 ? "warning" : null;

  return (
    <div className="kpis">
      <div className="kpi">
        <span className="kpi-label">Uptime</span>
        <span dir="ltr" className="kpi-value">{uptime(s.uptime_seconds)}</span>
        <span className="kpi-sub">Since <span dir="ltr">{cairoDay(since)}</span>{"\u00a0"}· {s.uptime_seconds < 86400 ? "rebooted in the last 24h" : "no reboots in 24h"}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">CPU 24h</span>
        <span dir="ltr" className="kpi-value">{k.cpu_avg_pct == null ? "—" : `${Math.round(k.cpu_avg_pct)}%`} <span className="kpi-unit">avg</span></span>
        <span className="kpi-sub">
          {cpuStatus ? <StatusIcon status={cpuStatus} size={12} /> : null}
          Peak <span dir="ltr" style={{ color: sevColor(cpuStatus) }}>{k.cpu_peak_pct == null ? "—" : `${Math.round(k.cpu_peak_pct)}%`}</span>
          {k.cpu_peak_at ? <> at <span dir="ltr">{cairoTime(k.cpu_peak_at)}</span></> : null}{"\u00a0"}· {s.cores}{"\u00a0"}cores
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-label">RAM</span>
        <span dir="ltr" className="kpi-value">{k.ram_used_mb == null ? "—" : (k.ram_used_mb / 1024).toFixed(1)} <span className="kpi-unit">/ {Math.round(s.ram_total_mb / 1024)} GB</span></span>
        {ramPct != null ? <Meter pct={ramPct} status={ramStatus} /> : null}
        <span className="kpi-sub">
          {ramStatus ? <StatusIcon status={ramStatus} size={12} /> : null}
          <span dir="ltr" style={{ color: sevColor(ramStatus) }}>{ramPct ?? "—"}%</span> used{k.ram_peak_pct != null ? <> · peak <span dir="ltr">{Math.round(k.ram_peak_pct)}%</span></> : null}
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Disk</span>
        <span dir="ltr" className="kpi-value">{k.disk_used_gb == null ? "—" : k.disk_used_gb.toFixed(1)} <span className="kpi-unit">/ {s.disk_total_gb} GB</span></span>
        {k.disk_used_pct != null ? <Meter pct={k.disk_used_pct} status={diskStatus} /> : null}
        <span className="kpi-sub" style={{ color: sevColor(diskStatus) }}>
          {diskStatus ? <StatusIcon status={diskStatus} size={12} /> : null}
          <span dir="ltr">{k.disk_used_pct ?? "—"}%</span>{"\u00a0"}· {days == null ? "No growth trend yet" : <><span dir="ltr">{days > 365 ? "365+" : days}</span> days until full</>}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* needs attention                                                     */
/* ------------------------------------------------------------------ */

function Attention({ a }: { a: AttentionItem }) {
  return (
    <li className="attn-item">
      <StatusPill status={sevStatus(a.severity)} size="sm" />
      <div className="attn-body">
        <span className="attn-title">{a.title}</span>
        {a.impact ? <span className="attn-impact">{a.impact}</span> : null}
        {a.action ? (
          <span className="attn-do">
            <strong>Do:</strong> {a.action}
          </span>
        ) : null}
      </div>
      <span dir="ltr" className="attn-id mono">{a.id}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* containers                                                          */
/* ------------------------------------------------------------------ */

const STATE: Record<string, { status: Status; label: string }> = {
  running: { status: "healthy", label: "Running" },
  restarting: { status: "critical", label: "Restarting" },
  exited: { status: "offline", label: "Exited" },
  paused: { status: "warning", label: "Paused" },
};

const DB_PORTS = new Set([5432, 6543, 3306, 6379, 27017]);

function Ports({ ports }: { ports: ContainerItem["ports"] }) {
  if (!ports.length) return <span className="subtle">—</span>;
  return (
    <span className="badges">
      {ports.map((p) =>
        p.public ? (
          <Badge key={p.port} tone={DB_PORTS.has(p.port) ? "critical" : "warning"} icon={<Globe size={12} strokeWidth={2} aria-hidden />}>
            <span dir="ltr" className="mono">{p.port}</span> PUBLIC
          </Badge>
        ) : (
          <Badge key={p.port} tone="muted" icon={<Lock size={12} strokeWidth={2} aria-hidden />}>
            <span dir="ltr" className="mono">{p.port}</span> local
          </Badge>
        ),
      )}
    </span>
  );
}

function ImageCell({ image, tag, pinned }: { image: string; tag: string | null; pinned: boolean }) {
  return (
    <span className="img-cell">
      <span dir="ltr" className="mono img-name">
        {image}:<span className="ink">{tag ?? "latest"}</span>
      </span>
      {pinned ? (
        <Badge tone="muted" icon={<Pin size={12} strokeWidth={2} aria-hidden />}>pinned</Badge>
      ) : (
        <Badge tone="warning" icon={<AlertTriangle size={12} strokeWidth={2} aria-hidden />}>latest</Badge>
      )}
    </span>
  );
}

function RamCell({ x }: { x: ContainerItem }) {
  if (x.mem_mb == null) return <span className="subtle">—</span>;
  if (x.mem_limit_mb == null) {
    return (
      <span className="ram-cell">
        <span dir="ltr" className="mono">{mb(x.mem_mb)}</span>
        <Badge tone="warning" icon={<AlertTriangle size={12} strokeWidth={2} aria-hidden />}>no limit</Badge>
      </span>
    );
  }
  const pct = Math.round((x.mem_mb / x.mem_limit_mb) * 100);
  const st: Status | null = pct >= 95 ? "critical" : pct >= 85 ? "warning" : null;
  return (
    <span className="ram-cell ram-cell--meter">
      <span dir="ltr" className="mono">
        {mb(x.mem_mb)} <span className="subtle">/ {mb(x.mem_limit_mb)}</span>
      </span>
      <Meter pct={pct} status={st} />
    </span>
  );
}

const CONTAINER_COLS: Col<ContainerItem>[] = [
            { label: "Name", cell: (x) => <span dir="ltr" className="cell-strong">{x.name}</span> },
            { label: "Image", wide: true, cell: (x) => <ImageCell image={x.image} tag={x.tag} pinned={x.pinned} /> },
            {
              label: "Status",
              cell: (x) => {
                const st = STATE[x.state] ?? { status: "offline" as Status, label: x.state };
                return <StatusPill status={st.status} size="sm" label={st.label} />;
              },
            },
            {
              label: "Restarts",
              className: "num",
              cell: (x) => (
                <span className="restarts">
                  {x.restarts_24h >= 3 ? <StatusText status="warning"><span dir="ltr">{x.restarts_24h}</span></StatusText> : <span dir="ltr" className={x.restarts_24h ? "" : "subtle"}>{x.restarts_24h}</span>}
                  {x.oom_kills_24h ? <Badge tone="critical" icon={<StatusIcon status="critical" size={12} />}><span dir="ltr">{x.oom_kills_24h}</span> OOM</Badge> : null}
                </span>
              ),
            },
            { label: "CPU", className: "num", cell: (x) => <span dir="ltr" className="mono">{x.cpu_pct == null ? "—" : `${x.cpu_pct}%`}</span> },
            { label: "RAM / limit", wide: true, cell: (x) => <RamCell x={x} /> },
            { label: "Ports", wide: true, cell: (x) => <Ports ports={x.ports} /> },
          ];

function Containers({ c }: { c: NonNullable<ServerDetail["blocks"]["containers"]> }) {
  const full = c.items.length === c.total;
  const rows = [...c.items].sort((a, z) => RANK[a.status] - RANK[z.status] || a.name.localeCompare(z.name));
  const isIssue = (x: ContainerItem) => x.status !== "healthy" || x.state !== "running" || !x.pinned || x.mem_limit_mb == null || x.restarts_24h > 0 || x.ports.some((p) => p.public);
  const issues = rows.filter(isIssue);
  const healthy = rows.filter((x) => !isIssue(x));
  const down = c.total - c.running;
  const meta = [
    `${c.running} / ${c.total} running`,
    c.restarts_24h ? plural(c.restarts_24h, "restart") : null,
    c.oom_kills_24h ? `${c.oom_kills_24h} OOM` : null,
    c.unpinned_images ? `${c.unpinned_images} "latest"` : null,
    c.missing_memory_limit ? `${c.missing_memory_limit} no limit` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Section title="Containers" id="sec-containers" meta={<span dir="ltr" style={{ color: down ? "var(--color-critical)" : undefined }}>{meta}</span>}>
      {!full ? (
        <p className="panel-note">
          {rows.length
            ? `Showing ${plural(rows.length, "container")} with issues out of ${c.total}. The collector sends the full list only for 20 containers or fewer.`
            : `All ${c.total} containers are running with no issues. The collector sends the full list only for 20 containers or fewer.`}
        </p>
      ) : null}
      {rows.length ? (
        <>
          {/* Desktop: the full table. Mobile: issues first, healthy containers folded. */}
          <div className="only-desktop">
            <DataTable<ContainerItem> label="Containers" rowKey={(x) => x.name} rows={rows} cols={CONTAINER_COLS} />
          </div>
          <div className="only-mobile">
            {issues.length ? <DataTable<ContainerItem> label="Containers with issues" rowKey={(x) => x.name} rows={issues} cols={CONTAINER_COLS} /> : null}
            {healthy.length ? (
              <details className="more" open={!issues.length && healthy.length <= 3}>
                <summary>
                  <StatusIcon status="healthy" size={14} /> {plural(healthy.length, "healthy container")}
                </summary>
                <DataTable<ContainerItem> label="Healthy containers" rowKey={(x) => x.name} rows={healthy} cols={CONTAINER_COLS} />
              </details>
            ) : null}
          </div>
        </>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* n8n                                                                 */
/* ------------------------------------------------------------------ */

function N8n({ instances }: { instances: N8nInstance[] }) {
  const many = instances.length > 5;
  const issues = instances.filter((x) => x.status !== "healthy" || x.executions_failed_24h >= 5 || x.telegram_webhooks.some((t) => !t.ok));
  const rows = many ? issues : instances;
  const ok = instances.reduce((n, x) => n + x.executions_ok_24h, 0);
  const failed = instances.reduce((n, x) => n + x.executions_failed_24h, 0);
  const active = instances.reduce((n, x) => n + x.workflows_active, 0);
  return (
    <Section title="n8n" id="sec-n8n" meta={<span dir="ltr">{plural(instances.length, "instance")} · {num(active)} workflows active · {num(ok)} ok · {num(failed)} failed</span>}>
      {many ? <p className="panel-note">{issues.length ? `${plural(issues.length, "instance")} with issues out of ${instances.length}.` : `All ${instances.length} instances are healthy.`}</p> : null}
      {rows.length ? (
        <DataTable<N8nInstance>
          label="n8n instances"
          rowKey={(x) => x.name}
          rows={rows}
          cols={[
            { label: "Instance", cell: (x) => <span dir="ltr" className="cell-strong">{x.container}</span> },
            {
              label: "Version",
              cell: (x) => (
                <span className="img-cell">
                  <span dir="ltr" className="mono">{x.version}</span>
                  {x.pinned ? null : <Badge tone="warning" icon={<AlertTriangle size={12} strokeWidth={2} aria-hidden />}>latest</Badge>}
                </span>
              ),
            },
            { label: "Status", cell: (x) => <StatusPill status={sevStatus(x.status)} size="sm" /> },
            { label: "Workflows", cell: (x) => <span dir="ltr" className="mono">{x.workflows_active} / {x.workflows_total}</span> },
            {
              label: "Executions 24h",
              wide: true,
              cell: (x) => (
                <span dir="ltr">
                  {num(x.executions_ok_24h)} ok ·{" "}
                  {x.executions_failed_24h >= 5 ? <StatusText status="warning">{x.executions_failed_24h} failed</StatusText> : <span className="subtle">{x.executions_failed_24h} failed</span>}
                </span>
              ),
            },
            { label: "Database", cell: (x) => <span dir="ltr">{x.db_type === "postgresdb" ? "Postgres" : "SQLite"} {mb(x.db_size_mb)}</span> },
            {
              label: "Telegram",
              cell: (x) => {
                const bad = x.telegram_webhooks.filter((t) => !t.ok).length;
                if (!x.telegram_webhooks.length) return <span className="subtle">Not set</span>;
                return bad ? <StatusText status="critical">{bad} mismatch</StatusText> : <StatusText status="healthy">{plural(x.telegram_webhooks.length, "bot")} OK</StatusText>;
              },
            },
            {
              label: "Memory limit",
              cell: (x) => (x.mem_limit_mb == null ? <Badge tone="warning" icon={<AlertTriangle size={12} strokeWidth={2} aria-hidden />}>no limit</Badge> : <span dir="ltr" className="mono">{mb(x.mem_limit_mb)}</span>),
            },
          ]}
        />
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* scripts and services                                                */
/* ------------------------------------------------------------------ */

interface SvcRow {
  name: string;
  kind: string;
  status: Status;
  detail: string;
}

function Services({ d }: { d: ServerDetail }) {
  const b = d.blocks;
  const ref = d.report.generated_at;
  const KIND: Record<string, string> = { systemd: "systemd", model: "Model service", api: "API", container: "Container" };
  const rows: SvcRow[] = [
    ...(b.services ?? []).map((x) => ({
      name: x.name,
      kind: KIND[x.kind] ?? x.kind,
      status: sevStatus(x.status),
      detail: [x.state === "running" ? "Running" : x.state, x.user === "root" ? "runs as root" : x.user ? `user ${x.user}` : null, x.port ? `port ${x.port} ${x.public ? "public" : "local"}` : null, x.latency_ms != null ? `latency ${ms(x.latency_ms)}` : null]
        .filter(Boolean)
        .join(" · "),
    })),
    ...(b.scripts ?? []).map((x) => ({
      name: x.name,
      kind: `${x.kind === "python" ? "Python" : x.kind === "shell" ? "Shell" : "Cron"}${x.schedule ? ` · ${x.schedule}` : " · manual"}`,
      status: sevStatus(x.status),
      detail: [x.last_run_at ? `Last run ${cairoWhen(x.last_run_at, ref)}` : "Never ran", x.last_result === "ok" ? "success" : x.last_result ?? "unknown", dur(x.duration_s)].join(" · "),
    })),
  ].sort((a, z) => RANK[a.status] - RANK[z.status]);
  const units = b.systemd_units;
  return (
    <Section
      title="Scripts and services"
      id="sec-services"
      meta={units ? <span>{units.running} systemd units running · {units.failed ? <StatusText status="critical">{units.failed} failed</StatusText> : "0 failed"}</span> : undefined}
    >
      <DataTable<SvcRow>
        label="Scripts and services"
        rowKey={(x) => x.name + x.kind}
        rows={rows}
        cols={[
          { label: "Name", cell: (x) => <span dir="ltr" className="cell-strong">{x.name}</span> },
          { label: "Kind", wide: true, cell: (x) => <span dir="ltr" className="muted" style={{ whiteSpace: "nowrap" }}>{x.kind}</span> },
          { label: "Status", cell: (x) => <StatusPill status={x.status} size="sm" /> },
          { label: "Detail", wide: true, cell: (x) => <span className="muted">{x.detail}</span> },
        ]}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* databases                                                           */
/* ------------------------------------------------------------------ */

function Databases({ rows, ref_ }: { rows: DatabaseItem[]; ref_: string }) {
  return (
    <Section title="Databases" id="sec-db" meta={plural(rows.length, "database")}>
      <DataTable<DatabaseItem>
        label="Databases"
        rowKey={(x) => x.name + x.engine}
        rows={rows}
        cols={[
          { label: "Name", cell: (x) => <span dir="ltr" className="cell-strong">{x.name}</span> },
          { label: "Engine", cell: (x) => <span dir="ltr">{x.engine}{x.version ? <span className="subtle"> {x.version}</span> : null}</span> },
          { label: "Status", cell: (x) => <StatusPill status={sevStatus(x.status)} size="sm" /> },
          { label: "Size", className: "num", cell: (x) => <span dir="ltr" className="mono">{mb(x.size_mb)}</span> },
          { label: "Growth 24h", className: "num", cell: (x) => <span dir="ltr" className="mono">{x.growth_mb_24h == null ? "—" : `+${mb(x.growth_mb_24h)}`}</span> },
          { label: "Connections", className: "num", cell: (x) => <span dir="ltr" className="mono">{x.connections == null ? "—" : `${num(x.connections)} / ${num(x.max_connections ?? 0)}`}</span> },
          {
            label: "Last backup",
            cell: (x) => {
              if (!x.last_backup_at) return x.status === "info" ? <span className="subtle">Not tracked</span> : <StatusText status="warning">Not found</StatusText>;
              const h = (Date.parse(ref_) - Date.parse(x.last_backup_at)) / 3600000;
              const st: Status = h > 168 ? "critical" : h > 48 ? "warning" : "healthy";
              return <StatusText status={st}>{ago(x.last_backup_at, ref_)}</StatusText>;
            },
          },
        ]}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* domains and TLS                                                     */
/* ------------------------------------------------------------------ */

function domainStatus(x: DomainItem): Status {
  if (!x.resolves_ok || !x.https_ok || x.renewal_ok === false || (x.cert_days_left != null && x.cert_days_left <= 7)) return "critical";
  if (x.cert_days_left != null && x.cert_days_left <= 21) return "warning";
  return "healthy";
}

function Domains({ rows }: { rows: DomainItem[] }) {
  const sorted = [...rows].sort((a, z) => RANK[domainStatus(a)] - RANK[domainStatus(z)]);
  const minDays = Math.min(...rows.map((x) => x.cert_days_left ?? 999));
  return (
    <Section title="Domains and TLS" id="sec-domains" meta={<>{plural(rows.length, "domain")} · next expiry in <span dir="ltr">{minDays}</span> days</>}>
      <DataTable<DomainItem>
        label="Domains and TLS"
        rowKey={(x) => x.domain}
        rows={sorted}
        cols={[
          { label: "Domain", cell: (x) => <span dir="ltr" className="cell-strong">{x.domain}</span> },
          { label: "DNS", cell: (x) => (x.resolves_ok ? <StatusText status="healthy">Resolves</StatusText> : <StatusText status="critical">Wrong IP</StatusText>) },
          { label: "HTTPS", cell: (x) => (x.https_ok ? <StatusText status="healthy">OK</StatusText> : <StatusText status="critical">Failing</StatusText>) },
          {
            label: "Certificate",
            cell: (x) => {
              if (x.cert_days_left == null) return <span className="subtle">—</span>;
              const st: Status = x.cert_days_left <= 7 ? "critical" : x.cert_days_left <= 21 ? "warning" : "healthy";
              return <StatusText status={st}><span dir="ltr">{x.cert_days_left}</span> days left</StatusText>;
            },
          },
          { label: "Renewal", cell: (x) => (x.renewal_ok == null ? <span className="subtle">Unknown</span> : x.renewal_ok ? <span className="muted">Auto · OK</span> : <StatusText status="critical">Failing</StatusText>) },
          { label: "Proxy", cell: (x) => <span className="muted">{x.server}</span> },
        ]}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* exposed ports + security                                            */
/* ------------------------------------------------------------------ */

function ExposedPorts({ d }: { d: ServerDetail }) {
  const sec = d.blocks.security!;
  const ports = [...sec.public_ports].sort((a, z) => Number(z.is_database) - Number(a.is_database) || a.port - z.port);
  const dbCount = ports.filter((p) => p.is_database).length;
  const dbStatus: Status = sec.firewall_active ? "warning" : "critical";
  return (
    <Section title="Exposed ports" id="sec-ports" meta={<>{plural(ports.length, "public port")}{dbCount ? <> · <StatusText status={dbStatus}>{dbCount} database</StatusText></> : null}</>}>
      {ports.length ? (
        <ul className="ports">
          {ports.map((p) => (
            <li key={`${p.port}/${p.proto}`} className="port-row">
              <span dir="ltr" className="mono port-num">{p.port}<span className="subtle">/{p.proto}</span></span>
              <span className="port-owner">
                <span dir="ltr">{p.owner}</span>
                <span dir="ltr" className="subtle mono"> on {p.bind}</span>
              </span>
              {p.is_database ? <Badge tone={dbStatus === "critical" ? "critical" : "warning"} icon={<StatusIcon status={dbStatus} size={12} />}>Database port</Badge> : <Badge tone="muted" icon={<Globe size={12} strokeWidth={2} aria-hidden />}>Public</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="all-good"><StatusText status="healthy">No public ports.</StatusText></div>
      )}
    </Section>
  );
}

function Security({ d }: { d: ServerDetail }) {
  const S = d.blocks.security!;
  const root = { no: "Disabled", "prohibit-password": "Key only", "without-password": "Key only", yes: "Password allowed" }[S.ssh_root_login];
  const rows: [string, string, Status][] = [
    ["SSH password login", S.ssh_password_auth ? "Enabled" : "Disabled", S.ssh_password_auth ? "critical" : "healthy"],
    ["Root login", root, S.ssh_root_login === "yes" ? "warning" : "healthy"],
    ["Firewall", S.firewall_active ? "Active" : "Inactive", S.firewall_active ? "healthy" : "warning"],
    ["Failed logins 24h", S.failed_logins_24h == null ? "—" : `${num(S.failed_logins_24h)}${S.ssh_password_auth ? "" : " (blocked by key auth)"}`, "healthy"],
    ["Unknown login IPs", S.unknown_login_ips.length ? `${S.unknown_login_ips.length} new` : "None", S.unknown_login_ips.length ? "warning" : "healthy"],
    ["Executables in /tmp", S.tmp_executables ? String(S.tmp_executables) : "None", S.tmp_executables ? "critical" : "healthy"],
    ["Security updates", S.pending_security_updates == null ? "—" : S.pending_security_updates ? `${S.pending_security_updates} pending` : "Up to date", (S.pending_security_updates ?? 0) > 10 ? "warning" : "healthy"],
    ["Reboot required", S.reboot_required ? "Yes" : "No", S.reboot_required ? "warning" : "healthy"],
  ];
  const cs = rows.filter((r) => r[2] === "critical").length;
  const ws = rows.filter((r) => r[2] === "warning").length;
  return (
    <Section title="Security" id="sec-security" meta={cs || ws ? [cs ? `${cs} critical` : "", ws ? `${ws} warning` : ""].filter(Boolean).join(" · ") : "All checks passed"}>
      <dl className="kv">
        {rows.map(([label, value, st]) => (
          <div key={label} className="kv-row">
            <dt>{label}</dt>
            <dd>{st === "healthy" ? <span className="stext"><StatusIcon status="healthy" size={14} /><span dir="ltr">{value}</span></span> : <StatusText status={st}><span dir="ltr">{value}</span></StatusText>}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* backups + changes                                                   */
/* ------------------------------------------------------------------ */

function Backups({ d }: { d: ServerDetail }) {
  const ref = d.report.generated_at;
  const rows = d.blocks.backups!;
  return (
    <Section title="Backups" id="sec-backups" meta={plural(rows.length, "backup")}>
      <ul className="list">
        {rows.map((x) => {
          const h = x.last_at ? (Date.parse(ref) - Date.parse(x.last_at)) / 3600000 : null;
          const st: Status = h == null ? "warning" : h > 168 ? "critical" : h > 48 ? "warning" : sevStatus(x.status);
          return (
            <li key={x.name} className="list-row">
              <div className="list-main">
                <span dir="ltr" className="cell-strong ellipsis">{x.name}</span>
                <span className="subtle list-sub">
                  {x.kind === "job" ? "Job" : "Folder"} · {x.last_at ? <>Last <span dir="ltr">{cairoWhen(x.last_at, ref)}</span></> : "Never"} · <span dir="ltr">{mb(x.size_mb)}</span>
                </span>
              </div>
              <StatusPill status={st} size="sm" label={x.last_at ? ago(x.last_at, ref) : "Not found"} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const CHANGE_KIND: Record<ChangeItem["type"], string> = {
  container_added: "Added",
  container_removed: "Removed",
  image_changed: "Image",
  port_opened: "Port opened",
  port_closed: "Port closed",
  config_changed: "Config",
  reboot: "Reboot",
};

function changeText(c: ChangeItem) {
  switch (c.type) {
    case "container_added":
      return <>Container <b dir="ltr">{c.entity}</b> created{c.to ? <> (<span dir="ltr" className="mono">{c.to}</span>)</> : null}</>;
    case "container_removed":
      return <>Container <b dir="ltr">{c.entity}</b> removed</>;
    case "image_changed":
      return <><b dir="ltr">{c.entity}</b> image <span dir="ltr" className="mono">{c.from}</span> → <span dir="ltr" className="mono">{c.to}</span></>;
    case "port_opened":
      return <>Port <span dir="ltr" className="mono">{c.to}</span> opened by <b dir="ltr">{c.entity}</b></>;
    case "port_closed":
      return <>Port <span dir="ltr" className="mono">{c.from}</span> closed (<span dir="ltr">{c.entity}</span>)</>;
    case "reboot":
      return <>Server rebooted</>;
    default:
      return <><b dir="ltr">{c.entity}</b> configuration changed</>;
  }
}

function Changes({ items, ref_ }: { items: ChangeItem[]; ref_: string }) {
  const sorted = [...items].sort((a, z) => Date.parse(z.at) - Date.parse(a.at));
  return (
    <Section title="Changes" id="sec-changes" meta={sorted.length ? `${plural(sorted.length, "change")} since the last report` : "None"}>
      {sorted.length ? (
        <ol className="timeline">
          {sorted.map((c) => (
            <li key={c.type + c.entity + c.at} className={`tl-item${c.type === "port_opened" || c.type === "reboot" ? " tl-item--note" : ""}`}>
              <span className="tl-time" dir="ltr">{cairoWhen(c.at, ref_)}</span>
              <span className="tl-body">
                <span className="tag">{CHANGE_KIND[c.type]}</span>
                <span>{changeText(c)}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="panel-note">No changes since the last report.</p>
      )}
    </Section>
  );
}
