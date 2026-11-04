export type Status = "critical" | "warning" | "offline" | "healthy";
export type Env = "production" | "demo" | "dev";

export const STATUS_ORDER: Record<Status, number> = { critical: 0, warning: 1, offline: 2, healthy: 3 };
export const STATUS_LABEL: Record<Status, string> = {
  critical: "Critical",
  warning: "Warning",
  offline: "Offline",
  healthy: "Healthy",
};

/** One row of the Fleet overview. Built from the latest payload v1 of each server. */
export interface ServerSummary {
  hostname: string;
  client: string;
  env: Env;
  status: Status;
  /** Short reason shown under the status pill, e.g. "Firewall inactive". */
  note: string;
  cpuPct: number | null;
  ramPct: number | null;
  diskPct: number | null;
  /** Workload chips, e.g. "5 n8n", "Supabase", "Python ×2". */
  workloads: string[];
  alertsCritical: number;
  alertsWarning: number;
  containersUp: number;
  containersTotal: number;
  /** ISO timestamp of the last report or heartbeat. */
  lastSeenAt: string;
}

export interface FleetSnapshot {
  generatedAt: string;
  sample: boolean;
  servers: ServerSummary[];
}
