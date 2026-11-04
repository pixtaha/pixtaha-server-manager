import "server-only";
import { SAMPLE_DETAILS, SAMPLE_FLEET } from "./sample-data";
import type { FleetSnapshot, ServerDetail } from "./types";

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
