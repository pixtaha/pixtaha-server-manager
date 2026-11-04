import "server-only";
import { connection } from "next/server";
import { liveAlerts, liveConfigured, liveFleet, liveServer } from "./live";
import { SAMPLE_ALERTS, SAMPLE_DETAILS, SAMPLE_FLEET } from "./sample-data";
import type { AlertsSnapshot, FleetSnapshot, ServerDetail } from "./types";

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

/** All alerts (open, acknowledged, resolved). Grouping of duplicates happens in the UI. */
export async function getAlerts(): Promise<AlertsSnapshot> {
  await connection();
  return liveConfigured() ? liveAlerts() : SAMPLE_ALERTS;
}
