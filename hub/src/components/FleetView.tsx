"use client";

import { ChevronDown, LayoutGrid, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { isFresh, useLivePoll } from "@/components/live/useLivePoll";
import { ago, cairoStamp } from "@/lib/format";
import { STATUS_LABEL, STATUS_ORDER, type FleetSnapshot, type LiveState, type ServerSummary, type Status } from "@/lib/types";
import { StatusPill } from "./StatusPill";

const STATUSES: Status[] = ["critical", "warning", "offline", "healthy"];

const barColor = (v: number) => (v >= 95 ? "var(--color-critical)" : v >= 85 ? "var(--color-warning)" : "var(--color-text-subtle)");
const barText = (v: number) => (v >= 95 ? "var(--color-critical)" : v >= 85 ? "var(--color-warning)" : "var(--color-text-muted)");
const noteColor = (s: Status) => (s === "critical" ? "var(--color-critical)" : s === "warning" ? "var(--color-warning)" : "var(--color-text-muted)");

function alertsText(s: ServerSummary) {
  if (!s.alertsCritical && !s.alertsWarning) return s.status === "offline" ? "—" : "None";
  return [s.alertsCritical ? `${s.alertsCritical} critical` : "", s.alertsWarning ? `${s.alertsWarning} warning` : ""].filter(Boolean).join(" · ");
}
const alertsColor = (s: ServerSummary) => (s.alertsCritical ? "var(--color-critical)" : s.alertsWarning ? "var(--color-warning)" : "var(--color-text-subtle)");

function bars(s: ServerSummary) {
  return ([["CPU", s.cpuPct], ["RAM", s.ramPct], ["Disk", s.diskPct]] as const).map(([k, v]) => ({ k, v, label: v == null ? "—" : `${v}%` }));
}

/** Live numbers over the last rendered report (collector 1.2.0+). */
function withLive(s: ServerSummary, l: LiveState | undefined, now: number): ServerSummary {
  if (!l || !l.live || !isFresh(l.live_at, now)) return s;
  const r = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  return {
    ...s,
    cpuPct: r(l.live.cpu) ?? s.cpuPct,
    ramPct: r(l.live.ram) ?? s.ramPct,
    diskPct: r(l.live.disk) ?? s.diskPct,
    containersUp: l.live.running ?? s.containersUp,
    containersTotal: l.live.total ?? s.containersTotal,
    lastSeenAt: l.live_at ?? s.lastSeenAt,
    live: true,
  };
}

export function FleetView({ fleet, loading = false }: { fleet: FleetSnapshot; loading?: boolean }) {
  const [q, setQ] = useState("");
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [client, setClient] = useState("All");
  const [env, setEnv] = useState("All");
  const router = useRouter();

  // live layer: numbers every 5 s; the page re-renders when a newer report lands or a server goes on/offline
  const { data: live, now } = useLivePoll<LiveState[]>(fleet.sample ? null : "/api/live", [], Date.parse(fleet.generatedAt));
  const byHost = useMemo(() => new Map(live.map((l) => [l.hostname, l])), [live]);
  const asked = useRef(0);
  useEffect(() => {
    if (fleet.sample || !live.length) return;
    const stale = fleet.servers.some((s) => {
      const l = byHost.get(s.hostname);
      if (!l) return false;
      const newerReport = l.last_report_at && s.lastReportAt && Date.parse(l.last_report_at) > Date.parse(s.lastReportAt);
      const fresh = isFresh(l.live_at, now);
      return newerReport || (s.status === "offline" && fresh) || (Boolean(s.live) && !fresh);
    });
    const due = now - Date.parse(fleet.generatedAt) > 120000; // safety net every 2 minutes
    if ((stale || due) && now - asked.current > 15000) {
      asked.current = now;
      router.refresh();
    }
  }, [live, byHost, now, fleet, router]);

  const servers = useMemo(() => fleet.servers.map((s) => withLive(s, byHost.get(s.hostname), now)), [fleet.servers, byHost, now]);
  const anyLive = servers.some((s) => s.live);
  const refNow = new Date(Math.max(now, Date.parse(fleet.generatedAt))).toISOString();
  const clients = useMemo(() => Array.from(new Set(servers.map((s) => s.client))).sort(), [servers]);
  const envs = useMemo(() => Array.from(new Set(servers.map((s) => s.env))), [servers]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return servers
      .filter((s) => !needle || `${s.hostname} ${s.client} ${s.workloads.join(" ")}`.toLowerCase().includes(needle))
      .filter((s) => !statuses.length || statuses.includes(s.status))
      .filter((s) => client === "All" || s.client === client)
      .filter((s) => env === "All" || s.env === env)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.hostname.localeCompare(b.hostname));
  }, [servers, q, statuses, client, env]);

  const count = (st: Status) => servers.filter((s) => s.status === st).length;
  const offline = servers.filter((s) => s.status === "offline");
  const up = servers.reduce((n, s) => n + s.containersUp, 0);
  const total = servers.reduce((n, s) => n + s.containersTotal, 0);
  const crit = servers.reduce((n, s) => n + s.alertsCritical, 0);
  const warn = servers.reduce((n, s) => n + s.alertsWarning, 0);

  const summary = [
    { label: "Servers", v: String(servers.length), sub: `${servers.length - offline.length} reporting`, c: "var(--color-text)" },
    { label: "Containers up", v: `${up} / ${total}`, sub: total - up ? `${total - up} down` : "All running", c: "var(--color-text)" },
    { label: "Critical alerts", v: String(crit), sub: "open", c: crit ? "var(--color-critical)" : "var(--color-text)" },
    { label: "Warning alerts", v: String(warn), sub: "open", c: warn ? "var(--color-warning)" : "var(--color-text)" },
    { label: "Offline agents", v: String(offline.length), sub: offline.map((s) => s.hostname).join(", ") || "All reporting", c: offline.length ? "var(--color-offline)" : "var(--color-text)" },
  ];

  const toggle = (st: Status) => setStatuses((cur) => (cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st]));
  const empty = !loading && servers.length === 0;

  return (
    <div className="stack">
      <div className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 className="page-title">Fleet</h1>
          <span className="page-meta">
            {fleet.sample ? `${cairoStamp(fleet.generatedAt)} · sample data` : anyLive ? (
              <><span className="heartbeat-dot heartbeat-dot--live" aria-hidden style={{ display: "inline-block", marginInlineEnd: 6 }} />Live · updates every 5 s</>
            ) : `${cairoStamp(fleet.generatedAt)} · updates when servers report`}
          </span>
        </div>
        <Link href="/add" className="px-btn px-btn--primary">
          <Plus size={18} strokeWidth={1.75} aria-hidden /> Add server
        </Link>
      </div>

      <div className="summary">
        {summary.map((s) => (
          <div key={s.label} className="summary-cell">
            <span className="summary-label">{s.label}</span>
            <span dir="ltr" className="summary-value" style={{ color: s.c }}>{loading ? "–" : s.v}</span>
            <span className="summary-sub" dir="ltr">{loading ? " " : s.sub}</span>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <label className="search">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search servers, clients, workloads" aria-label="Search servers" />
        </label>
        <label className="select">
          <span className="muted">Client</span>
          <select value={client} onChange={(e) => setClient(e.target.value)} aria-label="Filter by client">
            <option>All</option>
            {clients.map((c) => <option key={c}>{c}</option>)}
          </select>
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
        </label>
        <label className="select">
          <span className="muted">Env</span>
          <select value={env} onChange={(e) => setEnv(e.target.value)} aria-label="Filter by environment">
            <option>All</option>
            {envs.map((c) => <option key={c}>{c}</option>)}
          </select>
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
        </label>
        <div className="divider" />
        <div className="chip-row">
          {STATUSES.map((st) => (
            <button key={st} type="button" className="chip" aria-pressed={statuses.includes(st)} onClick={() => toggle(st)}>
              {STATUS_LABEL[st]} <span dir="ltr" className="chip-n">{count(st)}</span>
            </button>
          ))}
        </div>
        <span className="sort">Sort <strong>Severity</strong></span>
      </div>

      {/* desktop table */}
      <div className="table" role="table" aria-label="Servers">
        <div className="row row--head" role="row">
          <span>Server</span><span>Status</span><span>Resources</span><span>Workloads</span><span className="col-alerts">Alerts</span><span className="end">Heartbeat</span>
        </div>
        {loading ? <Skeleton /> : null}
        {empty ? <Empty /> : null}
        {!loading && rows.map((s) => (
          <Link key={s.hostname} href={`/servers/${s.hostname}`} className={`row row--body${s.status === "offline" ? " row--off" : ""}`} role="row">
            <div className="cell-name">
              <span dir="ltr" className="host">{s.hostname}</span>
              <span className="meta-line"><span className="env">{s.env}</span><span className="muted ellipsis" style={{ fontSize: 13 }}>{s.client}</span></span>
            </div>
            <div className="cell-status">
              <StatusPill status={s.status} size="sm" />
              {s.note ? <span className="note" style={{ color: noteColor(s.status) }}>{s.note}</span> : null}
            </div>
            <div dir="ltr" className="bars">
              {bars(s).map((b) => (
                <div key={b.k} className="bar">
                  <span>{b.k}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${b.v ?? 0}%`, background: barColor(b.v ?? 0) }} /></div>
                  <span className="bar-val" style={{ color: barText(b.v ?? 0) }}>{b.label}</span>
                </div>
              ))}
            </div>
            <div className="chips">{s.workloads.map((w) => <span key={w} className="tag">{w}</span>)}</div>
            <span dir="ltr" className="col-alerts" style={{ fontSize: 13, color: alertsColor(s), fontWeight: s.alertsCritical || s.alertsWarning ? 600 : 400 }}>{alertsText(s)}</span>
            <span className="end" title="Last heartbeat" style={{ fontSize: 13, color: s.status === "offline" ? "var(--color-offline)" : "var(--color-text-subtle)" }}>{ago(s.lastSeenAt, refNow)}</span>
          </Link>
        ))}
        {!loading && !empty && rows.length === 0 ? <div className="empty"><p>No servers match these filters.</p></div> : null}
      </div>

      {/* mobile cards */}
      <div className="cards">
        {loading ? [1, 2, 3].map((k) => <div key={k} className="card"><div className="skel" style={{ height: 14, width: "50%" }} /><div className="skel" style={{ height: 10, width: "70%" }} /></div>) : null}
        {empty ? <div className="card"><Empty /></div> : null}
        {!loading && rows.map((s) => (
          <Link key={s.hostname} href={`/servers/${s.hostname}`} className="card" style={{ opacity: s.status === "offline" ? 0.72 : 1 }}>
            <div className="card-top">
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span dir="ltr" className="host" style={{ fontSize: 16 }}>{s.hostname}</span>
                <span className="meta-line muted" style={{ fontSize: 13 }}><span className="ellipsis">{s.client}</span><span className="env">{s.env}</span></span>
              </div>
              <StatusPill status={s.status} size="sm" />
            </div>
            {s.note ? <span style={{ fontSize: 13, color: noteColor(s.status) }}>{s.note}</span> : null}
            <div dir="ltr" className="card-bars">
              {bars(s).map((b) => (
                <div key={b.k}>
                  <div className="card-bar-head"><span>{b.k}</span><span className="mono" style={{ color: barText(b.v ?? 0) }}>{b.label}</span></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${b.v ?? 0}%`, background: barColor(b.v ?? 0) }} /></div>
                </div>
              ))}
            </div>
            <div className="card-foot">
              <div className="chips">{s.workloads.map((w) => <span key={w} className="tag">{w}</span>)}</div>
              <span style={{ fontSize: 12, whiteSpace: "nowrap", color: s.status === "offline" ? "var(--color-offline)" : "var(--color-text-subtle)" }}>Last heartbeat {ago(s.lastSeenAt, refNow)}</span>
            </div>
          </Link>
        ))}
      </div>

      {fleet.sample && !empty ? <span className="foot-note">Sample data · fictional servers. Real servers appear here once their collector reports.</span> : null}
    </div>
  );
}

function Skeleton() {
  return (
    <>
      {[1, 2, 3, 4, 5, 6].map((k) => (
        <div key={k} className="row row--body" aria-hidden style={{ cursor: "default" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><div className="skel" style={{ height: 12, width: "60%" }} /><div className="skel" style={{ height: 10, width: "40%" }} /></div>
          <div className="skel" style={{ height: 22, width: 80, borderRadius: 999 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><div className="skel" style={{ height: 6 }} /><div className="skel" style={{ height: 6 }} /><div className="skel" style={{ height: 6 }} /></div>
          <div style={{ display: "flex", gap: 6 }}><div className="skel" style={{ height: 22, width: 60, borderRadius: 999 }} /><div className="skel" style={{ height: 22, width: 70, borderRadius: 999 }} /></div>
          <div className="skel col-alerts" style={{ height: 10, width: 30 }} />
          <div className="skel" style={{ height: 10, width: 50, justifySelf: "end" }} />
        </div>
      ))}
    </>
  );
}

function Empty() {
  return (
    <div className="empty">
      <div className="empty-icon"><LayoutGrid size={22} strokeWidth={1.75} aria-hidden /></div>
      <div className="empty-title">No servers yet</div>
      <p>Install the agent on your first server. It reports within a minute and your first daily report goes out at 09:00 Cairo.</p>
      <Link href="/add" className="px-btn px-btn--primary"><Plus size={18} strokeWidth={1.75} aria-hidden /> Add your first server</Link>
    </div>
  );
}
