import "server-only";
import { connection } from "next/server";
import { liveAccept, liveAlerts, liveConfigured, liveFleet, liveNowFleet, liveNowServer, liveRecheck, liveReport, liveReports, liveServer } from "./live";
import { SAMPLE_ALERTS, SAMPLE_DETAILS, SAMPLE_FLEET } from "./sample-data";
import type { AlertsSnapshot, FleetSnapshot, LiveState, ReportListItem, ServerDetail } from "./types";

/**
 * Data access for the hub. With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set, it reads the
 * schema server_manager on the self-hosted Supabase (see live.ts); without them it serves the
 * fictional sample fleet, so previews and local runs keep working.
 */
export async function getFleet(): Promise<FleetSnapshot> {
  await connection(); // always render per request: fleet data changes every report
  return liveConfigured() ? liveFleet() : SAMPLE_FLEET;
}

/** Latest payload v1 for one server, or `null` when the hostname is unknown. */
export async function getServer(hostname: string): Promise<ServerDetail | null> {
  await connection();
  return liveConfigured() ? liveServer(hostname) : (SAMPLE_DETAILS[hostname] ?? null);
}

/** Live channel for the browser poll. `null` in sample mode (nothing to poll). */
export async function getLive(hostname?: string): Promise<LiveState | LiveState[] | null> {
  if (!liveConfigured()) return null;
  return hostname ? liveNowServer(hostname) : liveNowFleet();
}

export async function requestRecheck(hostname: string): Promise<boolean> {
  if (!liveConfigured()) return false;
  return liveRecheck(hostname);
}

export async function setAccepted(hostname: string, key: string, accept: boolean, note: string | null, by: string | null): Promise<boolean> {
  if (!liveConfigured()) return false;
  return liveAccept(hostname, key, accept, note, by);
}

/** All alerts (open, acknowledged, resolved). Grouping of duplicates happens in the UI. */
export async function getAlerts(): Promise<AlertsSnapshot> {
  await connection();
  return liveConfigured() ? liveAlerts() : SAMPLE_ALERTS;
}

/** Every stored report, newest first. Sample mode lists the fictional servers' latest reports. */
export async function getReports(): Promise<{ sample: boolean; items: ReportListItem[] }> {
  await connection();
  if (liveConfigured()) return { sample: false, items: await liveReports() };
  return { sample: true, items: Object.values(SAMPLE_DETAILS).map(sampleItem).sort((a, b) => b.generated_at.localeCompare(a.generated_at)) };
}

export async function getReport(id: string): Promise<{ item: ReportListItem; detail: ServerDetail } | null> {
  await connection();
  if (liveConfigured()) return liveReport(id);
  const d = Object.values(SAMPLE_DETAILS).find((x) => x.report.id === id);
  return d ? { item: sampleItem(d), detail: d } : null;
}

function sampleItem(d: ServerDetail): ReportListItem {
  return {
    id: d.report.id, hostname: d.server.hostname, client: d.server.client, env: d.server.env, type: d.report.type,
    generated_at: d.report.generated_at, received_at: d.report.generated_at, status: d.hub_status,
    critical: d.attention.filter((a) => a.severity === "critical").length, warning: d.attention.filter((a) => a.severity === "warning").length,
  };
}
