"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { StatusIcon } from "@/components/StatusPill";
import { AnimatedNumber } from "@/components/live/AnimatedNumber";
import { isFresh, useLivePoll } from "@/components/live/useLivePoll";
import { ago, cairoDay, cairoTime, uptime } from "@/lib/format";
import type { Kpis, LivePoint, LiveSnapshot, LiveState, ServerInfo, Status } from "@/lib/types";
import { ResourceChart } from "./ResourceChart";

/*
 * Live layer of the Server detail page (collector 1.2.0+). The page itself is rendered on the server from
 * the newest report; this layer polls /api/live every 5 seconds for the live snapshot (KPI cards, charts,
 * heartbeat) and refreshes the page when a newer report (daily or 5-minute refresh) has been stored.
 * Without the live channel (older collector, report view, sample data) every part falls back to the report.
 */

interface Ctx {
  state: LiveState | null;
  now: number;
  failed: boolean;
}
const LiveCtx = createContext<Ctx | null>(null);

export function LiveProvider({ host, initial, reportAt, renderedAt, children }: { host: string; initial: LiveState | null; reportAt: string; renderedAt: string; children: ReactNode }) {
  const router = useRouter();
  const { data, now, failed } = useLivePoll<LiveState | null>(initial ? `/api/live?host=${encodeURIComponent(host)}` : null, initial, Date.parse(renderedAt));
  const asked = useRef(reportAt);

  useEffect(() => {
    asked.current = reportAt;
  }, [reportAt]);
  useEffect(() => {
    const at = data?.last_report_at;
    if (at && Date.parse(at) > Date.parse(asked.current)) {
      asked.current = at;
      router.refresh(); // new attention list, containers, domains... from the newest report
    }
  }, [data?.last_report_at, router]);

  return <LiveCtx.Provider value={{ state: data, now, failed }}>{children}</LiveCtx.Provider>;
}

function useLive(): { snap: LiveSnapshot | null; state: LiveState | null; now: number; failed: boolean } {
  const c = useContext(LiveCtx);
  if (!c) return { snap: null, state: null, now: 0, failed: false }; // report view: everything comes from the report
  return { snap: c.state && isFresh(c.state.live_at, c.now) ? c.state.live : null, state: c.state, now: c.now, failed: c.failed };
}

const sevColor = (s: Status | null) => (s === "critical" ? "var(--color-critical)" : s === "warning" ? "var(--color-warning)" : s === "offline" ? "var(--color-offline)" : undefined);
const gb = (vMb: number) => `${(vMb / 1024).toFixed(1).replace(/\.0$/, "")} GB`;

/* ------------------------------------------------------------------ */
/* heartbeat line + re-check                                           */
/* ------------------------------------------------------------------ */

export function LiveHeartbeat({ lastHeartbeatAt, collector, offline, renderedAt }: { lastHeartbeatAt: string; collector: string; offline: boolean; renderedAt: string }) {
  const { snap, state, now } = useLive();
  const ctx = useContext(LiveCtx);
  const seen = state?.live_at && Date.parse(state.live_at) > Date.parse(lastHeartbeatAt) ? state.live_at : lastHeartbeatAt;
  const isLive = Boolean(snap);
  const down = offline && !isLive;
  return (
    <span className="heartbeat" style={{ color: down ? "var(--color-offline)" : undefined }}>
      {down ? <StatusIcon status="offline" size={12} /> : <span key={isLive ? state?.live_at ?? "" : "static"} className={`heartbeat-dot${isLive ? " heartbeat-dot--live" : ""}`} aria-hidden />}
      {isLive ? "Live" : "Last heartbeat"} · {ago(seen, ctx ? new Date(Math.max(now, Date.parse(renderedAt))).toISOString() : renderedAt)} · agent v{snap?.collector ?? collector}
    </span>
  );
}

export function RecheckButton({ host }: { host: string }) {
  const c = useContext(LiveCtx);
  const [phase, setPhase] = useState<"idle" | "asking" | "waiting" | "done" | "error">("idle");
  const since = useRef<string | null>(null);
  const reportAt = c?.state?.last_report_at ?? null;

  useEffect(() => {
    if (phase === "waiting" && reportAt && since.current && Date.parse(reportAt) > Date.parse(since.current)) setPhase("done");
  }, [phase, reportAt]);
  useEffect(() => {
    if (phase === "done" || phase === "error") {
      const t = setTimeout(() => setPhase("idle"), 6000);
      return () => clearTimeout(t);
    }
    if (phase === "waiting") {
      const t = setTimeout(() => setPhase("error"), 4 * 60 * 1000);
      return () => clearTimeout(t);
    }
  }, [phase]);

  if (!c || !c.state) return null; // no live channel: the button could not reach the collector
  const ask = async () => {
    setPhase("asking");
    since.current = new Date().toISOString();
    try {
      const res = await fetch(`/api/live?host=${encodeURIComponent(host)}`, { method: "POST" });
      const body = (await res.json()) as { ok?: boolean };
      setPhase(res.ok && body.ok ? "waiting" : "error");
    } catch {
      setPhase("error");
    }
  };
  const label =
    phase === "asking" ? "Asking…" : phase === "waiting" ? "Checking… about a minute" : phase === "done" ? "Updated" : phase === "error" ? "Try again" : "Re-check now";
  return (
    <button type="button" className="px-btn px-btn--secondary" onClick={ask} disabled={phase === "asking" || phase === "waiting"} aria-live="polite">
      <RefreshCw size={18} strokeWidth={1.75} aria-hidden className={phase === "asking" || phase === "waiting" ? "spin" : undefined} /> {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* KPI cards                                                           */
/* ------------------------------------------------------------------ */

export function LiveKpis({ server: s, kpis: k, generatedAt }: { server: ServerInfo; kpis: Kpis; generatedAt: string }) {
  const { snap, now } = useLive();
  const ramTotal = snap?.ram_total_mb ?? s.ram_total_mb;
  const ramUsed = snap?.ram_mb ?? k.ram_used_mb;
  const ramPct = ramUsed == null || !ramTotal ? null : Math.round((ramUsed / ramTotal) * 100);
  const diskPct = snap?.disk ?? k.disk_used_pct;
  const diskGb = snap?.disk_gb ?? k.disk_used_gb;
  const diskTotal = snap?.disk_total_gb ?? s.disk_total_gb;
  const days = k.disk_days_until_full;

  const bootMs = snap?.boot_at ? Date.parse(snap.boot_at) : Date.parse(generatedAt) - s.uptime_seconds * 1000;
  const upS = Math.max(0, Math.round(((snap?.boot_at ? now : Date.parse(generatedAt)) - bootMs) / 1000));

  const ramStatus: Status | null = ramPct == null ? null : ramPct >= 95 ? "critical" : ramPct >= 90 ? "warning" : null;
  const diskStatus: Status | null =
    diskPct == null ? null : diskPct >= 90 || (days != null && days <= 3) ? "critical" : diskPct >= 80 || (days != null && days <= 14) ? "warning" : null;
  const cpuNow = snap?.cpu;
  const cpuStatus: Status | null = (cpuNow != null && cpuNow >= 95) || (k.cpu_peak_pct != null && k.cpu_peak_pct >= 95) ? "warning" : null;

  const tiles: { label: string; v: ReactNode; sub: ReactNode; st: Status | null }[] = [
    { label: "Uptime", v: uptime(upS), sub: `Since ${cairoDay(new Date(bootMs).toISOString())} · ${upS < 86400 ? "rebooted in the last 24h" : "no reboots"}`, st: null },
    snap && cpuNow != null
      ? {
          label: "CPU now",
          v: <><AnimatedNumber value={cpuNow} />%</>,
          sub: k.cpu_avg_pct == null ? `${snap.cores ?? s.cores} cores` : `24h avg ${Math.round(k.cpu_avg_pct)}% · peak ${Math.round(k.cpu_peak_pct ?? 0)}%`,
          st: cpuStatus,
        }
      : {
          label: "CPU 24h",
          v: k.cpu_avg_pct == null ? "—" : `${Math.round(k.cpu_avg_pct)}% avg`,
          sub: k.cpu_peak_pct == null ? "No data" : `Peak ${Math.round(k.cpu_peak_pct)}%${k.cpu_peak_at ? ` at ${cairoTime(k.cpu_peak_at)}` : ""}`,
          st: cpuStatus,
        },
    {
      label: "RAM",
      v: ramUsed == null ? "—" : <><AnimatedNumber value={ramUsed / 1024} format={(x) => x.toFixed(1)} /> / {gb(ramTotal)}</>,
      sub: ramPct == null ? "No data" : <><AnimatedNumber value={ramPct} />% used{snap?.swap_mb ? ` · swap ${snap.swap_mb} MB` : ""}</>,
      st: ramStatus,
    },
    {
      label: "Disk",
      v: diskPct == null ? "—" : <><AnimatedNumber value={diskPct} format={(x) => x.toFixed(1)} />%</>,
      sub: <>{diskGb == null ? "—" : <AnimatedNumber value={diskGb} format={(x) => x.toFixed(1)} />} / {diskTotal} GB · {days == null ? "no growth trend yet" : `full in ${days > 365 ? "365+" : days} days`}</>,
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
/* charts                                                              */
/* ------------------------------------------------------------------ */

const BUCKET_MS = 5 * 60 * 1000;
const BUCKETS = 288; // 24 h

/**
 * 288 five-minute slots ending at the current slot. Live points win; slots without one take the hourly value
 * of the newest report (refreshed every 5 minutes), so the chart keeps its 24 h history from the first minute.
 */
function series(points: LivePoint[], key: "cpu" | "ram" | "disk", now: number, hourly: (number | null)[] | undefined, reportEndIso: string): (number | null)[] {
  const end = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const start = end - (BUCKETS - 1) * BUCKET_MS;
  const repEnd = Date.parse(reportEndIso);
  const out: (number | null)[] = Array.from({ length: BUCKETS }, (_, i) => {
    if (!hourly || !hourly.length) return null;
    const t = start + i * BUCKET_MS;
    const h = hourly.length - 1 - Math.floor((repEnd - t) / 3600000);
    return t <= repEnd && h >= 0 && h < hourly.length ? hourly[h] : null;
  });
  for (const p of points) {
    const i = Math.round((Math.floor(Date.parse(p.at) / BUCKET_MS) * BUCKET_MS - start) / BUCKET_MS);
    if (i >= 0 && i < BUCKETS && p[key] != null) out[i] = p[key];
  }
  return out;
}

export function LiveCharts({ server: s, kpis: k, generatedAt }: { server: ServerInfo; kpis: Kpis; generatedAt: string }) {
  const { snap, state, now } = useLive();
  const points = state?.points ?? [];
  const useLiveSeries = Boolean(state) && (points.length > 0 || Boolean(snap));
  const endIso = useLiveSeries ? new Date(now).toISOString() : generatedAt;

  const cpu = useLiveSeries ? series(points, "cpu", now, k.cpu_hourly_pct, generatedAt) : k.cpu_hourly_pct;
  const ram = useLiveSeries ? series(points, "ram", now, k.ram_hourly_pct, generatedAt) : k.ram_hourly_pct;
  const disk = useLiveSeries ? series(points, "disk", now, k.disk_hourly_pct, generatedAt) : k.disk_hourly_pct;

  const nums = (v: (number | null)[] | undefined) => (v ?? []).filter((x): x is number => x != null);
  const cpuNums = nums(cpu);
  const cpuAvg = cpuNums.length ? cpuNums.reduce((a, b) => a + b, 0) / cpuNums.length : null;
  const cpuPeak = cpuNums.length ? Math.max(...cpuNums) : null;
  const cpuMeta = snap?.cpu != null
    ? `now ${Math.round(snap.cpu)}%${cpuAvg != null ? ` · avg ${Math.round(cpuAvg)}% · peak ${Math.round(cpuPeak ?? 0)}%` : ""}`
    : k.cpu_avg_pct == null ? "No data" : `avg ${Math.round(k.cpu_avg_pct)}% · peak ${Math.round(k.cpu_peak_pct ?? 0)}%`;

  const ramTotal = snap?.ram_total_mb ?? s.ram_total_mb;
  const ramUsed = snap?.ram_mb ?? k.ram_used_mb;
  const ramMeta = ramUsed == null ? "—" : `${(ramUsed / 1024).toFixed(1)} / ${gb(ramTotal)}`;

  const diskNums = nums(k.disk_hourly_pct);
  const diskPerDay = diskNums.length > 1 ? ((diskNums[diskNums.length - 1] - diskNums[0]) / 100) * s.disk_total_gb : null;
  const diskMeta = `${snap?.disk ?? k.disk_used_pct ?? "—"}%${diskPerDay == null ? "" : ` · ${diskPerDay >= 0 ? "+" : "−"}${Math.abs(diskPerDay).toFixed(1)} GB / day`}`;

  return (
    <section aria-label="Resources, last 24 hours" className="charts">
      <ResourceChart title="CPU" values={cpu} endIso={endIso} meta={cpuMeta} />
      {ram ? <ResourceChart title="Memory" values={ram} endIso={endIso} meta={ramMeta} /> : null}
      {disk ? <ResourceChart title="Disk" values={disk} endIso={endIso} meta={diskMeta} /> : null}
    </section>
  );
}
