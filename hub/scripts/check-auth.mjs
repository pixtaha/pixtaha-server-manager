// Auth regression check for the hub. Run it after a build:
//   npx next build && node scripts/check-auth.mjs
//
// It starts the built app three times against a fake Supabase on 127.0.0.1 (no real data, no
// secrets) and fails if anything reads dashboard data without a full session:
//   A. sign-in configured: every page and API needs a full session, including React Server
//      Component navigation requests that skip the (app) layout.
//   B. Supabase configured but HUB_SECRET missing: fail closed (no data, APIs answer 401).
//   C. sample mode (no Supabase): the fictional fleet still renders for previews.
//   D. signed in: a full session reads data; a session that has not finished setup is sent to setup.
// Public files the PWA needs (manifest, service worker, icons, offline page, login) must stay open.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const HUB_DIR = fileURLToPath(new URL("..", import.meta.url));
const NEXT_BIN = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const PAGES = ["/", "/alerts", "/add", "/reports", "/reports/r-1", "/servers/demo-host"];
const PUBLIC = ["/login", "/manifest.webmanifest", "/sw.js", "/icons/icon-192.png", "/offline.html"];
// Router state of a client that already shows "/" inside the (app) layout. With it, Next renders
// only the target page segment and skips the shared layout: the classic layout-only-auth gap.
const TREE = encodeURIComponent(JSON.stringify(["", { children: ["(app)", { children: ["__PAGE__", {}] }] }]));

let failures = 0;
function check(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
}

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
// Fake session cookies for scenario D: one fully signed in, one that has not finished setup.
const SESSIONS = {
  [sha256("full-session")]: { user_id: "u1", email: "owner@example.com", mfa_done: true, totp_enabled: true, passkeys: 1, disabled: false },
  [sha256("setup-session")]: { user_id: "u1", email: "owner@example.com", mfa_done: false, totp_enabled: false, passkeys: 0, disabled: false },
};

async function mockSupabase() {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let msg = {};
    try {
      msg = JSON.parse(body || "{}");
    } catch {
      msg = {};
    }
    const op = msg.op ?? "";
    const path = req.url ?? "";
    calls.push({ path, op });
    res.setHeader("Content-Type", "application/json");
    if (path.endsWith("/rpc/sm_auth")) {
      if (op === "rate_hit" || op === "rate_check") return res.end(JSON.stringify({ limited: false, retry_at: null, count: 1 }));
      if (op === "session_get") return res.end(JSON.stringify(SESSIONS[msg.args?.token_hash] ?? null));
      return res.end("null");
    }
    res.end("[]");
  });
  const port = await freePort();
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${port}`,
    dataCalls: () => calls.filter((c) => !c.path.endsWith("/rpc/sm_auth")).length,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function startApp(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: HUB_DIR,
    env: { PATH: process.env.PATH, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`${base}/offline.html`);
      return { base, stop: () => child.kill("SIGTERM") };
    } catch {
      await sleep(200);
    }
  }
  child.kill("SIGTERM");
  throw new Error(`the app did not start:\n${log}`);
}

const get = (base, path, headers = {}) => fetch(base + path, { redirect: "manual", headers });
const post = (base, path, body) =>
  fetch(base + path, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body) });

async function apisClosed(tag, base) {
  check((await get(base, "/api/live")).status === 401, `${tag} GET /api/live is 401`);
  check((await get(base, "/api/live?host=demo-host")).status === 401, `${tag} GET /api/live?host= is 401`);
  check((await post(base, "/api/live?host=demo-host", {})).status === 401, `${tag} POST /api/live (re-check) is 401`);
  check((await post(base, "/api/issues", { host: "demo-host", key: "k", accept: true })).status === 401, `${tag} POST /api/issues (accept) is 401`);
}

async function rscRequests(base) {
  for (const p of PAGES) await (await get(base, p, { RSC: "1", "Next-Router-State-Tree": TREE })).text();
}

async function scenarioA(db) {
  const app = await startApp({ HUB_SECRET: "a".repeat(48), SUPABASE_URL: db.url, SUPABASE_SERVICE_ROLE_KEY: "test-service-role" });
  try {
    for (const p of PAGES) {
      const r = await get(app.base, p);
      const to = r.headers.get("location") ?? "";
      check(r.status >= 300 && r.status < 400 && to.includes("/login"), `A ${p} redirects to /login (${r.status})`);
    }
    await rscRequests(app.base);
    await apisClosed("A", app.base);
    for (const p of PUBLIC) check((await get(app.base, p)).status === 200, `A ${p} stays public (PWA)`);
    check(db.dataCalls() === 0, `A no dashboard data read without a session, RSC requests included (data calls: ${db.dataCalls()})`);
  } finally {
    app.stop();
  }
}

async function scenarioB(db) {
  const before = db.dataCalls();
  const app = await startApp({ SUPABASE_URL: db.url, SUPABASE_SERVICE_ROLE_KEY: "test-service-role" });
  try {
    for (const p of PAGES) {
      const r = await get(app.base, p);
      check(r.status !== 200, `B ${p} is not served while sign-in is misconfigured (${r.status})`);
    }
    await rscRequests(app.base);
    await apisClosed("B", app.base);
    check(db.dataCalls() === before, `B fail closed: no dashboard data read (data calls: ${db.dataCalls() - before})`);
  } finally {
    app.stop();
  }
}

async function scenarioD(db) {
  const app = await startApp({ HUB_SECRET: "d".repeat(48), SUPABASE_URL: db.url, SUPABASE_SERVICE_ROLE_KEY: "test-service-role" });
  try {
    const full = { Cookie: "pm_session=full-session" };
    const before = db.dataCalls();
    const page = await get(app.base, "/", full);
    const to = page.headers.get("location") ?? "";
    check(!to.includes("/login"), `D a full session is not sent to sign-in (${page.status})`);
    check(db.dataCalls() > before, "D a full session reads dashboard data");
    check((await page.text()).includes("Add passkey"), "D a signed-in user sees Add passkey");
    check((await get(app.base, "/api/live", full)).status === 200, "D a full session gets /api/live");
    const setup = { Cookie: "pm_session=setup-session" };
    const r = await get(app.base, "/reports", setup);
    check((r.headers.get("location") ?? "").includes("/login/setup"), `D a session without finished setup goes to /login/setup (${r.status})`);
    check((await get(app.base, "/api/live", setup)).status === 401, "D a session without finished setup gets 401 from /api/live");
  } finally {
    app.stop();
  }
}

async function scenarioC() {
  const app = await startApp({});
  try {
    const r = await get(app.base, "/");
    const html = await r.text();
    check(r.status === 200 && html.includes("core-01"), `C sample mode still renders the fictional fleet (${r.status})`);
    check((await get(app.base, "/api/live")).status === 200, "C sample mode /api/live answers (no real data)");
  } finally {
    app.stop();
  }
}

const db = await mockSupabase();
try {
  await scenarioA(db);
  await scenarioB(db);
  await scenarioC();
  await scenarioD(db);
} finally {
  await db.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll auth checks passed");
process.exit(failures ? 1 : 0);
