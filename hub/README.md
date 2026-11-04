# Server Manager hub

Next.js dashboard for Pixtaha Management, built from the Claude Design export (Pixtaha Design System).

Phase 0: Fleet overview with **sample data only** (fictional servers, `src/lib/sample-data.ts`). Real data will come from the Supabase schema `server_manager` once the collector reports.

    npm install
    npm run dev        # http://localhost:3000
    npm run build

Preview states: `/?state=empty`, `/?state=loading`.

Rules: no real server data (hostnames, IPs, ports) in this public repo; env vars by name only in `.env.example`.
