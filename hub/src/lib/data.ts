import "server-only";
import { SAMPLE_ALERTS, SAMPLE_DETAILS, SAMPLE_FLEET } from "./sample-data";
import type { AlertsSnapshot, FleetSnapshot, ServerDetail } from "./types";

/**
 * Data access for the hub. Phase 0 serves the sample fleet.
 * Next step: read the latest snapshot per server from the Supabase schema `server_manager`.
 */
export async function getFleet(): Promise<FleetSnapshot> {
  return SAMPLE_FLEET;
}

/** Latest payload v1 for one server, or `null` when the hostname is unknown. */
export async function getServer(hostname: string): Promise<ServerDetail | null> {
  return SAMPLE_DETAILS[hostname] ?? null;
}

/** All alerts (open, acknowledged, resolved). Grouping of duplicates happens in the UI. */
export async function getAlerts(): Promise<AlertsSnapshot> {
  return SAMPLE_ALERTS;
}
