import { NextResponse } from "next/server";
import { authConfigured, getSession } from "@/lib/auth/server";
import { setAccepted } from "@/lib/data";

/**
 * POST /api/issues  { host, key, accept: boolean, note?: string }
 * "Accept" (or undo) an attention item: it stays listed but no longer sets the server status.
 * Needs a full session (MFA done); same-origin only.
 */
export const dynamic = "force-dynamic";

const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  let by: string | null = null;
  if (authConfigured()) {
    const s = await getSession();
    if (!s || !s.mfa_done) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
    by = s.email;
  }
  const origin = req.headers.get("origin");
  const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host")].filter(Boolean);
  if (origin && !hosts.includes(new URL(origin).host)) return NextResponse.json({ error: "bad origin" }, { status: 403, headers: noStore });

  let body: { host?: unknown; key?: unknown; accept?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400, headers: noStore });
  }
  const host = typeof body.host === "string" ? body.host : "";
  const key = typeof body.key === "string" ? body.key : "";
  const note = typeof body.note === "string" ? body.note.slice(0, 300) : null;
  if (!HOST.test(host) || !key || key.length > 500 || typeof body.accept !== "boolean") {
    return NextResponse.json({ error: "bad request" }, { status: 400, headers: noStore });
  }
  try {
    const ok = await setAccepted(host, key, body.accept, note, by);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: noStore });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
  }
}
