import "server-only";
import { SAMPLE_FLEET } from "./sample-data";
import type { FleetSnapshot } from "./types";

/**
 * Data access for the hub. Phase 0 serves the sample fleet.
 * Next step: read the latest snapshot per server from the Supabase schema `server_manager`.
 */
export async function getFleet(): Promise<FleetSnapshot> {
  return SAMPLE_FLEET;
}
