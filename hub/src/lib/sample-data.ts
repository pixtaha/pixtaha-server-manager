import type { FleetSnapshot, ServerSummary } from "./types";

/**
 * Sample fleet for the public demo build.
 * Every hostname and client here is fictional: real server data never goes into this repo.
 * Shapes and numbers mirror the Claude Design concept so the screens can be reviewed before the collector runs.
 */
const NOW = Date.parse("2026-11-04T07:14:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

const s = (v: ServerSummary) => v;

export const SAMPLE_FLEET: FleetSnapshot = {
  generatedAt: new Date(NOW).toISOString(),
  sample: true,
  servers: [
    s({ hostname: "core-01", client: "Pixtaha", env: "production", status: "critical", note: "Public database ports", cpuPct: 21, ramPct: 68, diskPct: 28, workloads: ["5 n8n", "Supabase", "Python ×2", "siglip2"], alertsCritical: 1, alertsWarning: 4, containersUp: 21, containersTotal: 21, lastSeenAt: ago(14) }),
    s({ hostname: "nilehub-api", client: "Nile Hub Logistics", env: "production", status: "critical", note: "3 OOM kills in 24h", cpuPct: 78, ramPct: 96, diskPct: 52, workloads: ["Flask API ×3", "Postgres", "Redis"], alertsCritical: 1, alertsWarning: 1, containersUp: 7, containersTotal: 8, lastSeenAt: ago(9) }),
    s({ hostname: "lens-studio", client: "Lens Studio", env: "production", status: "warning", note: "Firewall inactive", cpuPct: 9, ramPct: 44, diskPct: 23, workloads: ["1 n8n", "Supabase", "rembg", "Flask API"], alertsCritical: 0, alertsWarning: 4, containersUp: 15, containersTotal: 15, lastSeenAt: ago(11) }),
    s({ hostname: "souq-sahel-web", client: "Souq Sahel", env: "production", status: "warning", note: "Disk 87% · 11 days until full", cpuPct: 31, ramPct: 58, diskPct: 87, workloads: ["Next.js", "Supabase"], alertsCritical: 0, alertsWarning: 1, containersUp: 12, containersTotal: 12, lastSeenAt: ago(6) }),
    s({ hostname: "dentaplus-crm", client: "DentaPlus Clinics", env: "production", status: "offline", note: "Last seen 7m ago", cpuPct: null, ramPct: null, diskPct: null, workloads: ["2 n8n", "Postgres"], alertsCritical: 0, alertsWarning: 0, containersUp: 0, containersTotal: 3, lastSeenAt: ago(420) }),
    s({ hostname: "flows-platform", client: "Flows Academy", env: "production", status: "healthy", note: "", cpuPct: 34, ramPct: 60, diskPct: 46, workloads: ["33 n8n", "Next.js", "Postgres"], alertsCritical: 0, alertsWarning: 0, containersUp: 38, containersTotal: 38, lastSeenAt: ago(8) }),
    s({ hostname: "facility-ops", client: "Delta Facility Co", env: "production", status: "healthy", note: "", cpuPct: 6, ramPct: 33, diskPct: 31, workloads: ["1 n8n", "Postgres"], alertsCritical: 0, alertsWarning: 0, containersUp: 9, containersTotal: 9, lastSeenAt: ago(13) }),
    s({ hostname: "redsea-tours", client: "Red Sea Tours", env: "production", status: "healthy", note: "", cpuPct: 12, ramPct: 41, diskPct: 38, workloads: ["3 n8n", "Next.js"], alertsCritical: 0, alertsWarning: 0, containersUp: 6, containersTotal: 6, lastSeenAt: ago(5) }),
    s({ hostname: "greenleaf-ml", client: "Greenleaf Agritech", env: "production", status: "healthy", note: "", cpuPct: 44, ramPct: 71, diskPct: 52, workloads: ["Python ×4", "Model service"], alertsCritical: 0, alertsWarning: 0, containersUp: 4, containersTotal: 4, lastSeenAt: ago(10) }),
    s({ hostname: "delta-legal-demo", client: "Delta Legal", env: "demo", status: "healthy", note: "", cpuPct: 4, ramPct: 22, diskPct: 18, workloads: ["3 n8n"], alertsCritical: 0, alertsWarning: 0, containersUp: 3, containersTotal: 3, lastSeenAt: ago(12) }),
    s({ hostname: "cairo-print-shop", client: "Cairo Print Co", env: "demo", status: "healthy", note: "", cpuPct: 3, ramPct: 19, diskPct: 14, workloads: ["Flask API", "SQLite"], alertsCritical: 0, alertsWarning: 0, containersUp: 2, containersTotal: 2, lastSeenAt: ago(7) }),
    s({ hostname: "mansoura-dev", client: "Pixtaha", env: "dev", status: "healthy", note: "", cpuPct: 15, ramPct: 37, diskPct: 41, workloads: ["Python ×4", "Supabase"], alertsCritical: 0, alertsWarning: 0, containersUp: 4, containersTotal: 4, lastSeenAt: ago(4) }),
  ],
};
