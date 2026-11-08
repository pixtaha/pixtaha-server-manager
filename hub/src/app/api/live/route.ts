import { NextResponse } from "next/server";
import { authConfigured, getSession } from "@/lib/auth/server";
import { getLive, requestRecheck } from "@/lib/data";

/**
 * Live channel for the browser (polled every 5 seconds while a page is open).
 *   GET  /api/live              all servers: live snapshot + last report time
 *   GET  /api/live?host=<name>  one server, plus 24 h of 5-minute points
 *   POST /api/live?host=<name>  "Re-check now": ask the collector for a refresh report
 * Same session rules as the pages: a full session (MFA done) is required.
 */
export const dynamic = "force-dynamic";

const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
const noStore = { "Cache-Control": "no-store" };

async function allowed(): Promise<boolean> {
  if (!authConfigured()) return true;
  const s = await getSession();
  return Boolean(s && s.mfa_done);
}

export async function GET(req: Request) {
  if (!(await allowed())) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  const host = new URL(req.url).searchParams.get("host") ?? undefined;
  if (host !== undefined && !HOST.test(host)) return NextResponse.json({ error: "bad host" }, { status: 400, headers: noStore });
  try {
    return NextResponse.json({ data: await getLive(host) }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "live data unavailable" }, { status: 503, headers: noStore });
  }
}

export async function POST(req: Request) {
  if (!(await allowed())) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  const origin = req.headers.get("origin");
  const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host")].filter(Boolean);
  if (origin && !hosts.includes(new URL(origin).host)) return NextResponse.json({ error: "bad origin" }, { status: 403, headers: noStore });
  const host = new URL(req.url).searchParams.get("host") ?? "";
  if (!HOST.test(host)) return NextResponse.json({ error: "bad host" }, { status: 400, headers: noStore });
  try {
    return NextResponse.json({ ok: await requestRecheck(host) }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "re-check unavailable" }, { status: 503, headers: noStore });
  }
}
