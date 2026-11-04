import { AlertTriangle, Globe, Mail } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusIcon, StatusPill, sevStatus } from "@/components/StatusPill";
import { ago, cairoDay, cairoStamp, cairoTime, cairoWhen, dur, mb, ms, num, uptime } from "@/lib/format";
import type { AttentionItem, ChangeItem, ContainerItem, DomainItem, N8nInstance, ServerDetail, Severity, Status } from "@/lib/types";
import { ResourceChart } from "./ResourceChart";

/*
 * Server detail, ported from docs/design/dashboard-app.dc.html (pg.detail).
 * Layout: header, 4 KPI cards, 3 charts, then a main column + 380px side column.
 */

const RANK: Record<Severity, number> = { critical: 0, warning: 1, offline: 2, unknown: 3, info: 4, healthy: 5 };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const sevColor = (s: Status | null) => (s === "critical" ? "var(--color-critical)" : s === "warning" ? "var(--color-warning)" : s === "offline" ? "var(--color-offline)" : undefined);
/** 16384 MB -> "16 GB", 8000 MB -> "7.8 GB". */
const gb = (vMb: number) => `${(vMb / 1024).toFixed(1).replace(/\.0$/, "")} GB`;

/* ------------------------------------------------------------------ */
/* building blocks                                                     */
/* ------------------------------------------------------------------ */

function Section({ title, meta, children, id, flush }: { title: string; meta?: ReactNode; children: ReactNode; id: string; flush?: boolean }) {
  return (
    <section className={`panel${flush ? " panel--flush" : ""}`} aria-labelledby={id}>
      <header className="panel-head">
        <h2 id={id} className="panel-title">{title}</h2>
        {meta ? <span className="panel-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** Icon + text, coloured by status. Never colour alone. */
function StatusText({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className="stext" style={{ color: sevColor(status) }}>
      <StatusIcon status={status} size={13} />
      {children}
    </span>
  );
}

function Badge({ tone, children }: { tone: "warning" | "critical"; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      <AlertTriangle size={11} strokeWidth={2} aria-hidden />
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

/** Table on desktop; at 900px and below each row becomes a labelled card (.dtable in app.css). */
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

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

/** `asReport`: render a stored report from the history (Daily reports) instead of the live server. */
export function ServerDetailView({ d, now, asReport }: { d: ServerDetail; now: string; asReport?: { id: string } }) {
  const { server: s, kpis: k, blocks: b, report } = d;
  const status = d.hub_status;
  const ref = report.generated_at;
  const offline = status === "offline";
  const attention = [...d.attention].sort((a, z) => RANK[a.severity] - RANK[z.severity]);
  const specs = `${s.cores} cores · ${gb(s.ram_total_mb)} RAM · ${s.os}`;

  const ramMeta = k.ram_used_mb == null ? "—" : `${(k.ram_used_mb / 1024).toFixed(1)} / ${gb(s.ram_total_mb)}`;
  const diskNums = (k.disk_hourly_pct ?? []).filter((v): v is number => v != null);
  const diskPerDay = diskNums.length > 1 ? ((diskNums[diskNums.length - 1] - diskNums[0]) / 100) * s.disk_total_gb : null;

  return (
    <div className="stack detail">
      <nav aria-label="Breadcrumb" className="crumbs">
        {asReport ? <Link href="/reports">Daily reports</Link> : <Link href="/">Fleet</Link>}
        <span aria-hidden>/</span>
        <span dir="ltr" aria-current="page">{asReport ? asReport.id : s.hostname}</span>
      </nav>

      {/* ---------- health header ---------- */}
      <header className="health">
        <div className="health-id">
          <div className="health-top">
            <h1 dir="ltr" className="health-host">{s.hostname}</h1>
            <StatusPill status={status} />
          </div>
          <div className="health-meta">
            <span>{s.client}</span>
            <span className="env env--lg">{s.env}</span>
            {s.public_ip ? <span dir="ltr" className="mono health-ip">{s.public_ip}</span> : null}
            <span aria-hidden>·</span>
            <span>{specs}</span>
          </div>
        </div>
        <div className="health-side">
          {asReport ? (
            <>
              <span className="heartbeat">Report of {cairoStamp(ref)} · agent v{report.collector_version}</span>
              <Link href={`/servers/${encodeURIComponent(s.hostname)}`} className="px-btn px-btn--secondary">Current state</Link>
            </>
          ) : (
            <>
              <span className="heartbeat" style={{ color: offline ? "var(--color-offline)" : undefined }}>
                {offline ? <StatusIcon status="offline" size={12} /> : <span className="heartbeat-dot" aria-hidden />}
                Last heartbeat {ago(s.last_heartbeat_at, now)} · agent v{report.collector_version}
              </span>
              <Link href={`/reports?server=${encodeURIComponent(s.hostname)}`} className="px-btn px-btn--secondary">
                <Mail size={18} strokeWidth={1.75} aria-hidden /> Reports
              </Link>
            </>
          )}
        </div>
      </header>

      {offline ? (
        <p className="offline-note">
          <StatusText status="offline">No heartbeat for {ago(s.last_heartbeat_at, now).replace(" ago", "")}. Showing the last report from {cairoTime(ref)} Cairo.</StatusText>
        </p>
      ) : null}

      <Kpis d={d} />

      <section aria-label="Resources, last 24 hours" className="charts">
        <ResourceChart
          title="CPU"
          values={k.cpu_hourly_pct}
          endIso={ref}
          meta={k.cpu_avg_pct == null ? "No data" : `avg ${Math.round(k.cpu_avg_pct)}% · peak ${Math.round(k.cpu_peak_pct ?? 0)}%`}
        />
        {k.ram_hourly_pct ? <ResourceChart title="Memory" values={k.ram_hourly_pct} endIso={ref} meta={ramMeta} /> : null}
        {k.disk_hourly_pct ? (
          <ResourceChart
            title="Disk"
            values={k.disk_hourly_pct}
            endIso={ref}
            meta={`${k.disk_used_pct ?? "—"}%${diskPerDay == null ? "" : ` · ${diskPerDay >= 0 ? "+" : "−"}${Math.abs(diskPerDay).toFixed(1)} GB / day`}`}
          />
        ) : null}
      </section>

      <div className="detail-grid">
        <div className="detail-main">
          <Section title="Needs attention" id="sec-attention" meta={attention.length ? `${attention.length} open · most severe first` : "None open"}>
            {attention.length ? (
              <ol className="attn">
                {attention.map((a, i) => <Attention key={a.id + a.title} a={a} n={i + 1} />)}
              </ol>
            ) : (
              <div className="panel-body">
                <StatusText status="healthy">Nothing needs attention. All checks passed.</StatusText>
              </div>
            )}
          </Section>

          {b.containers ? <Containers c={b.containers} /> : null}
          {b.n8n && b.n8n.instances.length ? <N8n instances={b.n8n.instances} /> : null}

          <div className="detail-pair">
            {(b.services && b.services.length) || (b.scripts && b.scripts.length) || b.systemd_units ? <Services d={d} /> : null}
            {(b.databases && b.databases.length) || (b.domains && b.domains.length) ? (
              <div className="detail-col">
                {b.databases && b.databases.length ? <Databases d={d} /> : null}
                {b.domains && b.domains.length ? <Domains rows={b.domains} /> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="detail-side">
          {b.security ? <Security d={d} /> : null}
          {b.security ? <ExposedPorts d={d} /> : null}
          <Timeline items={d.changes} ref_={ref} />
          {b.backups && b.backups.length ? <Backups d={d} /> : null}
        </div>
      </div>

      {d.sample ? <span className="foot-note">Sample data · fictional server. Real details appear here once the collector reports.</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI cards                                                           */
/* ------------------------------------------------------------------ */

function Kpis({ d }: { d: ServerDetail }) {
  const { server: s, kpis: k, report } = d;
  const since = new Date(Date.parse(report.generated_at) - s.uptime_seconds * 1000).toISOString();
  const ramPct = k.ram_used_mb == null ? null : Math.round((k.ram_used_mb / s.ram_total_mb) * 100);
  const ramStatus: Status | null = ramPct == null ? null : ramPct >= 95 ? "critical" : ramPct >= 90 ? "warning" : null;
  const days = k.disk_days_until_full;
  const diskStatus: Status | null =
    k.disk_used_pct == null ? null : k.disk_used_pct >= 90 || (days != null && days <= 3) ? "critical" : k.disk_used_pct >= 80 || (days != null && days <= 14) ? "warning" : null;
  const cpuStatus: Status | null = k.cpu_peak_pct != null && k.cpu_peak_pct >= 95 ? "warning" : null;

  const tiles: { label: string; v: string; sub: ReactNode; st: Status | null }[] = [
    { label: "Uptime", v: uptime(s.uptime_seconds), sub: `Since ${cairoDay(since)} · ${s.uptime_seconds < 86400 ? "rebooted in the last 24h" : "no reboots"}`, st: null },
    {
      label: "CPU 24h",
      v: k.cpu_avg_pct == null ? "—" : `${Math.round(k.cpu_avg_pct)}% avg`,
      sub: k.cpu_peak_pct == null ? "No data" : `Peak ${Math.round(k.cpu_peak_pct)}%${k.cpu_peak_at ? ` at ${cairoTime(k.cpu_peak_at)}` : ""}`,
      st: cpuStatus,
    },
    { label: "RAM", v: k.ram_used_mb == null ? "—" : `${(k.ram_used_mb / 1024).toFixed(1)} / ${gb(s.ram_total_mb)}`, sub: ramPct == null ? "No data" : `${ramPct}% used`, st: ramStatus },
    {
      label: "Disk",
      v: k.disk_used_pct == null ? "—" : `${k.disk_used_pct}%`,
      sub: `${k.disk_used_gb == null ? "—" : k.disk_used_gb.toFixed(1)} / ${s.disk_total_gb} GB · ${days == null ? "no growth trend yet" : `full in ${days > 365 ? "365+" : days} days`}`,
      st: diskStatus,
    },
  ];
  return (
    <div className="kpis">
      {tiles.map((t) => (
        <div key={t.label} className="kpi">
          <span className="kpi-label">{t.label}</span>
          <span dir="ltr" className="kpi-value" style={{ color: sevColor(t.st) }}>{t.v}</span>
          <span className="kpi-sub" style={{ color: sevColor(t.st) }}>
            {t.st ? <StatusIcon status={t.st} size={12} /> : null}
            {t.sub}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* needs attention                                                     */
/* ------------------------------------------------------------------ */

function Attention({ a, n }: { a: AttentionItem; n: number }) {
  return (
    <li className="attn-item">
      <span className="attn-n mono" aria-hidden>{String(n).padStart(2, "0")}</span>
      <span className="attn-title">{a.title}</span>
      <StatusPill status={sevStatus(a.severity)} size="sm" />
      {a.impact ? <span className="attn-text muted">{a.impact}</span> : null}
      {a.action ? (
        <span className="attn-text">
          <span className="subtle">Do:</span> {a.action}
        </span>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* containers                                                          */
/* ------------------------------------------------------------------ */

const STATE: Record<string, { status: Status; label: string }> = {
  running: { status: "healthy", label: "Up" },
  restarting: { status: "critical", label: "Restarting" },
  exited: { status: "offline", label: "Exited" },
  paused: { status: "warning", label: "Paused" },
};

function Ports({ ports }: { ports: ContainerItem["ports"] }) {
  if (!ports.length) return <span className="subtle">—</span>;
  const pub = ports.filter((p) => p.public);
  const loc = ports.filter((p) => !p.public);
  return (
    <span className="ports-cell">
      {pub.length ? (
        <span className="stext" style={{ color: "var(--color-warning)" }}>
          <Globe size={12} strokeWidth={2} aria-label="Public" />
          <span dir="ltr" className="mono">{pub[0].bind}:{pub.map((p) => p.port).join(", ")}</span>
        </span>
      ) : null}
      {loc.length ? <span dir="ltr" className="mono muted">{loc[0].bind}:{loc.map((p) => p.port).join(", ")}</span> : null}
    </span>
  );
}

const CONTAINER_COLS: Col<ContainerItem>[] = [
  { label: "Name", cell: (x) => <span dir="ltr" className="cell-strong">{x.name}</span> },
  {
    label: "Image",
    wide: true,
    cell: (x) => (
      <span className="img-cell">
        <span dir="ltr" className="mono img-name" title={`${x.image}:${x.tag ?? "latest"}`}>{x.image}:{x.tag ?? "latest"}</span>
        {x.pinned ? null : <Badge tone="warning">latest</Badge>}
      </span>
    ),
  },
  {
    label: "State",
    cell: (x) => {
      const st = STATE[x.state] ?? { status: "offline" as Status, label: x.state };
      return (
        <span className="state-cell">
          <StatusPill status={st.status} size="sm" variant="plain" label={st.label} />
          {x.oom_kills_24h ? <StatusText status="critical">{x.oom_kills_24h} OOM</StatusText> : null}
          {x.restarts_24h ? (x.restarts_24h >= 3 ? <StatusText status="warning">{plural(x.restarts_24h, "restart")}</StatusText> : <span className="subtle">{plural(x.restarts_24h, "restart")}</span>) : null}
        </span>
      );
    },
  },
  { label: "CPU", cell: (x) => <span dir="ltr" className="mono">{x.cpu_pct == null ? "—" : `${x.cpu_pct}%`}</span> },
  {
    label: "Memory / limit",
    cell: (x) =>
      x.mem_limit_mb == null ? (
        <span className="mem-cell">
          <span dir="ltr" className="mono nowrap">{mb(x.mem_mb)} <span className="subtle">/ —</span></span>
          <Badge tone="warning">no limit</Badge>
        </span>
      ) : (
        <span dir="ltr" className="mono nowrap" style={{ color: x.mem_mb != null && x.mem_mb / x.mem_limit_mb >= 0.9 ? "var(--color-warning)" : undefined }}>
          {mb(x.mem_mb)} / {mb(x.mem_limit_mb)}
        </span>
      ),
  },
  { label: "Published ports", wide: true, cell: (x) => <Ports ports={x.ports} /> },
];

function Containers({ c }: { c: NonNullable<ServerDetail["blocks"]["containers"]> }) {
  const full = c.items.length === c.total;
  const rows = [...c.items].sort((a, z) => RANK[a.status] - RANK[z.status] || a.name.localeCompare(z.name));
  const isIssue = (x: ContainerItem) => x.status !== "healthy" || x.state !== "running" || !x.pinned || x.mem_limit_mb == null || x.restarts_24h > 0 || x.ports.some((p) => p.public);
  const issues = rows.filter(isIssue);
  const healthy = rows.filter((x) => !isIssue(x));
  const meta = `${c.running} / ${c.total} up · ${plural(c.restarts_24h, "restart")} · ${c.oom_kills_24h} OOM · ${c.unpinned_images} on "latest" · ${c.missing_memory_limit} without memory limit`;
  return (
    <Section title="Containers" id="sec-containers" flush meta={<span dir="ltr" style={{ color: c.running < c.total ? "var(--color-critical)" : undefined }}>{meta}</span>}>
      {!full ? (
        <p className="panel-note">
          {rows.length
            ? `Showing ${plural(rows.length, "container")} with issues out of ${c.total}. The collector sends the full list only for 20 containers or fewer.`
            : `All ${c.total} containers are up with no issues. The collector sends the full list only for 20 containers or fewer.`}
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

function n8nIssues(x: N8nInstance): { status: Status; text: string }[] {
  const out: { status: Status; text: string }[] = [];
  const bad = x.telegram_webhooks.filter((t) => !t.ok).length;
  if (bad) out.push({ status: "critical", text: `${x.container}: ${plural(bad, "Telegram webhook")} registered to another URL` });
  if ((x.executions_failed_24h ?? 0) >= 5) out.push({ status: "warning", text: `${x.container}: ${x.executions_failed_24h} failed executions in 24h` });
  if (x.dead_host_nodes) out.push({ status: "warning", text: `${x.container}: ${plural(x.dead_host_nodes, "HTTP Request node")} call a dead host` });
  if (x.schedules_missed_24h) out.push({ status: "warning", text: `${x.container}: ${plural(x.schedules_missed_24h, "scheduled run")} missed` });
  if (x.db_type === "sqlite" && ((x.db_size_mb ?? 0) > 1024 || (x.db_growth_mb_24h ?? 0) > 100)) out.push({ status: "warning", text: `${x.container}: SQLite database is ${mb(x.db_size_mb)}` });
  return out;
}

function N8n({ instances }: { instances: N8nInstance[] }) {
  const many = instances.length > 5;
  const flagged = instances.filter((x) => x.status !== "healthy" || n8nIssues(x).length);
  const rows = many ? flagged : instances;
  const issues = instances.flatMap(n8nIssues);
  const ok = instances.reduce((n, x) => n + (x.executions_ok_24h ?? 0), 0);
  const meta = many ? `${plural(instances.length, "instance")} · ${instances.length - flagged.length} healthy · ${num(ok)} executions ok` : plural(instances.length, "instance");
  return (
    <Section title="n8n" id="sec-n8n" flush meta={meta}>
      {many && !flagged.length ? <p className="panel-note">All {instances.length} instances are healthy. Instances with issues are listed here.</p> : null}
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
                  <span dir="ltr" className="mono">{x.version ?? "—"}</span>
                  {x.pinned ? null : <Badge tone="warning">latest</Badge>}
                </span>
              ),
            },
            { label: "Workflows", cell: (x) => (x.workflows_total == null ? <span className="subtle">—</span> : <span dir="ltr">{num(x.workflows_active)} / {num(x.workflows_total)}</span>) },
            {
              label: "Executions 24h",
              cell: (x) => (
                <span dir="ltr">
                  {x.executions_ok_24h == null ? (
                    <span className="subtle">Not readable</span>
                  ) : (
                    <>
                      {num(x.executions_ok_24h)} ok · {(x.executions_failed_24h ?? 0) >= 5 ? <StatusText status="warning">{x.executions_failed_24h} failed</StatusText> : `${num(x.executions_failed_24h)} failed`}
                    </>
                  )}
                </span>
              ),
            },
            { label: "Database", cell: (x) => <span dir="ltr">{x.db_type === "postgresdb" ? "Postgres" : "SQLite"} {mb(x.db_size_mb)}</span> },
            {
              label: "Telegram",
              cell: (x) => {
                const n = x.telegram_webhooks.length;
                const bad = x.telegram_webhooks.filter((t) => !t.ok).length;
                if (!n) return <span className="subtle">Not set</span>;
                return bad ? <StatusText status="critical">{plural(n, "bot")} · {bad} mismatch</StatusText> : <span>{plural(n, "bot")} · webhook OK</span>;
              },
            },
            { label: "Missed", cell: (x) => <span dir="ltr" style={{ color: x.schedules_missed_24h ? "var(--color-warning)" : undefined }}>{x.schedules_missed_24h ?? "—"}</span> },
          ]}
        />
      ) : null}
      {issues.map((i) => (
        <div key={i.text} className="panel-issue">
          <StatusPill status={i.status} size="sm" />
          <span>{i.text}</span>
        </div>
      ))}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* scripts and services                                                */
/* ------------------------------------------------------------------ */

function Services({ d }: { d: ServerDetail }) {
  const b = d.blocks;
  const ref = d.report.generated_at;
  const KIND: Record<string, string> = { systemd: "systemd unit", model: "Model service", api: "API", container: "Container" };
  const rows = [
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
      kind: `${x.kind === "python" ? "Python script" : x.kind === "shell" ? "Shell script" : "Cron job"} · ${x.schedule ?? "manual"}`,
      status: sevStatus(x.status),
      detail: [x.last_run_at ? `Last run ${cairoWhen(x.last_run_at, ref)}` : "Never ran", x.last_result === "ok" ? "success" : x.last_result ?? "unknown", dur(x.duration_s)].join(" · "),
    })),
  ].sort((a, z) => RANK[a.status] - RANK[z.status]);
  const units = b.systemd_units;
  return (
    <Section title="Scripts and services" id="sec-services">
      <ul className="rows">
        {rows.map((x) => (
          <li key={x.name + x.kind} className="svc">
            <div className="svc-top">
              <span dir="ltr" className="cell-strong">{x.name}</span>
              <StatusPill status={x.status} size="sm" variant="plain" />
            </div>
            <span dir="ltr" className="svc-kind">{x.kind}</span>
            <span className="svc-detail">{x.detail}</span>
          </li>
        ))}
        {units ? (
          <li className="kv-row">
            <span className="muted">systemd units</span>
            <span>
              {units.running} running · {units.failed ? <StatusText status="critical">{units.failed} failed</StatusText> : "0 failed"}
            </span>
          </li>
        ) : null}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* databases                                                           */
/* ------------------------------------------------------------------ */

function Databases({ d }: { d: ServerDetail }) {
  const rows = d.blocks.databases!;
  const ref = d.report.generated_at;
  const publicDb = (d.blocks.security?.public_ports ?? []).some((p) => p.is_database);
  return (
    <Section title="Databases" id="sec-db" meta={publicDb ? <StatusPill status={d.blocks.security?.firewall_active ? "warning" : "critical"} size="sm" variant="plain" label="Public port" /> : undefined}>
      <ul className="rows">
        {rows.map((x) => {
          const h = x.last_backup_at ? (Date.parse(ref) - Date.parse(x.last_backup_at)) / 3600000 : null;
          const bst: Status = h == null ? "warning" : h > 168 ? "critical" : h > 48 ? "warning" : "healthy";
          return (
            <li key={x.name + x.engine} className="db">
              <div className="db-name">
                <span className="cell-strong">{x.engine === "Supabase" ? "Supabase" : x.name}</span>
                <span dir="ltr" className="mono subtle db-ver">{x.engine === "Supabase" ? x.version?.toLowerCase() : `${x.engine.toLowerCase()} ${x.version ?? ""}`}</span>
              </div>
              <div className="db-cell">
                <span className="db-k">Size · 24h</span>
                <span dir="ltr">{mb(x.size_mb)} · {x.growth_mb_24h == null ? "—" : `+${mb(x.growth_mb_24h)}`}</span>
              </div>
              <div className="db-cell">
                <span className="db-k">Connections</span>
                <span dir="ltr">{x.connections == null ? "—" : `${num(x.connections)} / ${num(x.max_connections ?? 0)}`}</span>
              </div>
              <div className="db-cell">
                <span className="db-k">Last backup</span>
                {x.last_backup_at ? (
                  bst === "healthy" ? <span>{ago(x.last_backup_at, ref)}</span> : <StatusText status={bst}>{ago(x.last_backup_at, ref)}</StatusText>
                ) : x.status === "info" ? (
                  <span className="subtle">Not tracked</span>
                ) : (
                  <StatusText status="warning">Not found</StatusText>
                )}
              </div>
              <div className="db-cell">
                <span className="db-k">Status</span>
                <StatusPill status={sevStatus(x.status)} size="sm" variant="plain" />
              </div>
            </li>
          );
        })}
      </ul>
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
  const sorted = [...rows].sort((a, z) => RANK[domainStatus(a)] - RANK[domainStatus(z)] || (a.cert_days_left ?? 999) - (z.cert_days_left ?? 999));
  return (
    <Section title="Domains and TLS" id="sec-domains">
      <ul className="rows">
        {sorted.map((x) => {
          const st = domainStatus(x);
          const sub = [x.resolves_ok ? "Resolves to expected IP" : "Resolves to the wrong IP", x.https_ok ? "HTTPS OK" : "HTTPS failing", x.renewal_ok === false ? "renewal failing" : null].filter(Boolean).join(" · ");
          return (
            <li key={x.domain} className="kv-row kv-row--top">
              <span className="dom-main">
                <span dir="ltr" className="cell-strong ellipsis">{x.domain}</span>
                <span className="dom-sub" style={{ color: !x.resolves_ok || !x.https_ok || x.renewal_ok === false ? "var(--color-critical)" : undefined }}>{sub}</span>
              </span>
              {x.cert_days_left == null ? (
                <span className="subtle">—</span>
              ) : st === "healthy" ? (
                <span dir="ltr" className="muted nowrap">{x.cert_days_left} days</span>
              ) : (
                <StatusText status={st}><span dir="ltr">{x.cert_days_left} days</span></StatusText>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* side column: security, exposed ports, timeline, backups             */
/* ------------------------------------------------------------------ */

function Security({ d }: { d: ServerDetail }) {
  const S = d.blocks.security!;
  const root = { no: "Disabled", "prohibit-password": "Key only", "without-password": "Key only", yes: "Password allowed" }[S.ssh_root_login];
  const rows: [string, string, Status | null][] = [
    ["SSH password login", S.ssh_password_auth ? "Enabled" : "Disabled", S.ssh_password_auth ? "critical" : null],
    ["Root login", root, S.ssh_root_login === "yes" ? "warning" : null],
    ["Failed logins 24h", S.failed_logins_24h == null ? "—" : num(S.failed_logins_24h), null],
    ["Firewall", S.firewall_active ? "Active" : "Inactive", S.firewall_active ? null : "warning"],
    ["Unknown login IPs", S.unknown_login_ips.length ? `${S.unknown_login_ips.length} new` : "None", S.unknown_login_ips.length ? "warning" : null],
  ];
  if (S.tmp_executables) rows.push(["Executables in /tmp", String(S.tmp_executables), "critical"]);
  if (S.pending_security_updates != null) rows.push(["Security updates pending", String(S.pending_security_updates), S.pending_security_updates > 10 ? "warning" : null]);
  if (S.reboot_required) rows.push(["Reboot required", "Yes", "warning"]);
  return (
    <Section title="Security" id="sec-security">
      <dl className="rows kv">
        {rows.map(([label, value, st]) => (
          <div key={label} className="kv-row">
            <dt className="muted">{label}</dt>
            <dd>{st ? <StatusText status={st}><span dir="ltr">{value}</span></StatusText> : <span dir="ltr">{value}</span>}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function ExposedPorts({ d }: { d: ServerDetail }) {
  const sec = d.blocks.security!;
  const ports = [...sec.public_ports].sort((a, z) => a.port - z.port);
  const dbStatus: Status = sec.firewall_active ? "warning" : "critical";
  const svcName = (p: (typeof ports)[number]) => (p.port === 22 ? "ssh" : p.port === 80 ? `http · ${p.owner}` : p.port === 443 ? `https · ${p.owner}` : p.owner);
  return (
    <Section title="Exposed ports" id="sec-ports" meta={`${ports.length} public`}>
      {ports.length ? (
        <ul className="rows">
          {ports.map((p) => (
            <li key={`${p.port}/${p.proto}`} className="port-row">
              <span dir="ltr" className="mono" style={{ color: p.is_database ? sevColor(dbStatus) : undefined }}>{p.port}</span>
              <span dir="ltr" className="muted ellipsis">{svcName(p)}</span>
              {p.is_database ? <span className="port-flag"><StatusText status={dbStatus}>Database port</StatusText></span> : <span />}
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel-body"><StatusText status="healthy">No public ports.</StatusText></div>
      )}
    </Section>
  );
}

const CHANGE_KIND: Record<ChangeItem["type"], string> = {
  container_added: "Added",
  container_removed: "Removed",
  image_changed: "Image",
  port_opened: "Port",
  port_closed: "Port",
  config_changed: "Config",
  reboot: "Reboot",
};

function changeText(c: ChangeItem) {
  switch (c.type) {
    case "container_added":
      return `Container ${c.entity} created${c.to ? ` (${c.to})` : ""}`;
    case "container_removed":
      return `Container ${c.entity} removed`;
    case "image_changed":
      return `${c.entity} updated from ${c.from} to ${c.to}`;
    case "port_opened":
      return `Port ${c.to} opened by ${c.entity}`;
    case "port_closed":
      return `Port ${c.from} closed (${c.entity})`;
    case "reboot":
      return "Server rebooted";
    default:
      return `${c.entity} configuration changed`;
  }
}

function Timeline({ items, ref_ }: { items: ChangeItem[]; ref_: string }) {
  const sorted = [...items].sort((a, z) => Date.parse(z.at) - Date.parse(a.at));
  return (
    <Section title="Changes timeline" id="sec-changes">
      {sorted.length ? (
        <ol className="timeline">
          {sorted.map((c) => (
            <li key={c.type + c.entity + c.at} className="tl-item">
              <span className="tl-rail" aria-hidden>
                <span className="tl-dot" style={{ borderColor: c.type === "port_opened" ? "var(--color-warning)" : undefined }} />
                <span className="tl-line" />
              </span>
              <span className="tl-body">
                <span className="tl-when">{cairoWhen(c.at, ref_)} · {CHANGE_KIND[c.type]}</span>
                <span className="tl-text">{changeText(c)}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="panel-body muted">No changes since the last report.</div>
      )}
    </Section>
  );
}

function Backups({ d }: { d: ServerDetail }) {
  const ref = d.report.generated_at;
  return (
    <Section title="Backups" id="sec-backups">
      <ul className="rows">
        {d.blocks.backups!.map((x) => {
          const h = x.last_at ? (Date.parse(ref) - Date.parse(x.last_at)) / 3600000 : null;
          const st: Status | null = h == null ? "warning" : h > 168 ? "critical" : h > 48 ? "warning" : null;
          const value = x.last_at ? `${cairoTime(x.last_at)} · ${ago(x.last_at, ref)} · ${mb(x.size_mb)}` : "Not found";
          return (
            <li key={x.name} className="kv-row">
              <span dir="ltr" className="muted ellipsis">{x.name}</span>
              {st ? <StatusText status={st}><span dir="ltr">{value}</span></StatusText> : <span dir="ltr" className="nowrap">{value}</span>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
