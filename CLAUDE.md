# Pixtaha Server Manager

Read-only monitoring for a fleet of 30+ Linux servers across 10+ clients, branded "Pixtaha Management".
Owner: Taha (Pixtaha). Talk to him in Egyptian Arabic; everything in the repo is English only.

## Layout
- `hub/` Next.js 16 dashboard (App Router, TypeScript), deployed by Vercel from `main` (project `pixtaha-server-manager`, root `hub`).
- `email/` daily report email builder used by the n8n Code node "Build Report Email".
- `docs/report/payload-v1.md` the payload contract: collector -> n8n webhook -> email, and later -> Supabase -> hub.
- `docs/kickoff/` original brief, project instructions, server discovery prompt.
- `docs/design/` sanitized Claude Design export: source markup for Fleet, Server detail, Alerts, Add server and Login. Port screens from here.

## Hard rules
- **This repo is PUBLIC.** Never commit real server data: hostnames of client servers, IPs, open ports, domains of client systems, server files, example payloads with real values, tokens. Sample data stays fictional (`hub/src/lib/sample-data.ts`).
- Never print or commit secrets. Env vars by NAME only (`hub/.env.example`); values live in Vercel / n8n credentials.
- All code, comments, commits, docs and prompts in English.
- Pin dependency versions (exact versions in package.json).
- The agent/collector is read-only on servers: it never changes anything.

## Design
- Pixtaha Design System tokens in `hub/src/styles/tokens.css` (from the Claude Design export). Do not invent colors or fonts.
- Dark is primary, light must work. Status is always icon + text label, never color alone.
- Logical CSS properties only (`inline-start/end`) so Arabic RTL mirrors later. Numbers, versions and IPs stay LTR.
- Desktop first; every screen must work at 375px.
- Fonts are self-hosted with @fontsource (no Google Fonts at build time).

## Hub roadmap
1. Fleet overview — done (sample data).
2. Server detail — done (sample data).
3. Alerts center: open / acknowledged / resolved, grouped duplicates, bulk acknowledge.
4. Add server: name, client, env, one-line install command, waiting-for-heartbeat state.
5. Login — done: passkey first, fallback password + TOTP, backup codes, rate limits (hub-owned accounts, `supabase/migrations/0004_hub_auth.sql`).
6. Data — done: schema `server_manager` (migrations in `supabase/`), n8n stores every report, hub reads via service-role RPCs.
7. Live — done: collector 1.2.0 pushes a live snapshot every 5 s and a refresh report every 5 min straight to Supabase (`0007_live.sql`); pages poll `/api/live` every 5 s; "Re-check now".

## Checks before every push
- `cd hub && npx tsc --noEmit && npx next build && node scripts/check-auth.mjs`
- Auth: every function in `hub/src/lib/data.ts` and every API route checks the viewer itself
  (`viewer()` / `requireViewer()` in `hub/src/lib/auth/server.ts`). Never rely on the `(app)` layout
  alone: client navigations can render a page without running its layout. Sign-in fails closed.
- `git grep` for real IPs, client hostnames or tokens before committing.
