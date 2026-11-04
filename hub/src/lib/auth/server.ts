import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";

/**
 * Dashboard login, server side. All crypto lives here; the database (server_manager.hub_*) only
 * stores hashes and encrypted secrets, reached through the service-role-only RPC public.sm_auth.
 *
 * Env (names only, values in Vercel): HUB_SECRET (32+ random chars), HUB_ADMIN_EMAIL,
 * HUB_INVITE_TOKEN (one-time setup link), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const SESSION_COOKIE = "pm_session";
const PENDING_COOKIE = "pm_pending";
const CHALLENGE_COOKIE = "pm_webauthn";
const SESSION_HOURS = 12;
const TRUSTED_DAYS = 30;

export function authConfigured(): boolean {
  return Boolean(process.env.HUB_SECRET && process.env.HUB_SECRET.length >= 32 && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ------------------------------------------------------------------ store

export async function db<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const url = `${process.env.SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/rpc/sm_auth`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ op, args }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`auth store ${op}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface HubUser {
  id: string;
  email: string;
  password_hash: string | null;
  totp_secret_enc: string | null;
  totp_enabled: boolean;
  disabled: boolean;
  passkeys: number;
}

// ------------------------------------------------------------------ crypto helpers

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

function secretKey(purpose: string): Buffer {
  return createHash("sha256").update(`${process.env.HUB_SECRET}|${purpose}`).digest();
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Same cost as a real check when the user does not exist, so timing does not reveal emails. */
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = (stored ?? DUMMY_HASH).split("$");
  if (alg !== "scrypt") return false;
  const out = await scrypt(pw.normalize("NFKC"), Buffer.from(salt, "base64url"), 32, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return stored != null && timingSafeEqual(out, Buffer.from(hash, "base64url"));
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secretKey("totp"), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}

export function decrypt(blob: string): string {
  const [, iv, enc, tag] = blob.split(".");
  const d = createDecipheriv("aes-256-gcm", secretKey("totp"), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

/** Signed, expiring value for short-lived cookies (pending MFA, WebAuthn challenge). */
function sign(data: Record<string, unknown>, ttlSec: number): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ttlSec * 1000 })).toString("base64url");
  return `${body}.${createHmac("sha256", secretKey("cookie")).update(body).digest("base64url")}`;
}

function unsign<T>(value: string | undefined): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac || !safeEqual(mac, createHmac("sha256", secretKey("cookie")).update(body).digest("base64url"))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return data.exp > Date.now() ? (data as T) : null;
}

// ------------------------------------------------------------------ TOTP (RFC 6238, SHA-1, 30 s, 6 digits)

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secretB32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", unbase32(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Accepts the current step and one step either side (clock drift). */
export function verifyTotp(secretB32: string, code: string): boolean {
  const c = code.replace(/\D/g, "");
  if (c.length !== 6) return false;
  const now = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => safeEqual(totpAt(secretB32, now + d), c));
}

export function newTotpSecret(): string {
  return base32(randomBytes(20));
}

// ------------------------------------------------------------------ backup codes

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const normalizeBackup = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function newBackupCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

// ------------------------------------------------------------------ request context

export async function clientInfo(): Promise<{ ip: string; ua: string; origin: string; rpID: string }> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return { ip, ua: h.get("user-agent") ?? "", origin: `${proto}://${host}`, rpID: host.split(":")[0] };
}

// ------------------------------------------------------------------ rate limits

/** Records a hit; `limited` once the window holds more than `max` hits. */
export async function rateHit(key: string, max: number, windowS: number): Promise<{ limited: boolean; retryAt: string; count: number }> {
  const r = await db<{ limited: boolean; retry_at: string; count: number }>("rate_hit", { key, max, window_s: windowS });
  return { limited: r.limited, retryAt: r.retry_at, count: r.count };
}

export async function rateCheck(key: string, max: number, windowS: number): Promise<{ limited: boolean; retryAt: string }> {
  const r = await db<{ limited: boolean; retry_at: string }>("rate_check", { key, max, window_s: windowS });
  return { limited: r.limited, retryAt: r.retry_at };
}

// ------------------------------------------------------------------ sessions

export interface Session {
  user_id: string;
  email: string;
  mfa_done: boolean;
  totp_enabled: boolean;
  passkeys: number;
  disabled: boolean;
}

const cookieOpts = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge });

export async function createSession(userId: string, mfaDone: boolean, trusted = false): Promise<void> {
  const token = randomToken();
  const hours = mfaDone && trusted ? TRUSTED_DAYS * 24 : SESSION_HOURS;
  const { ip, ua } = await clientInfo();
  await db("session_create", { token_hash: sha256(token), user_id: userId, mfa_done: mfaDone, expires_at: new Date(Date.now() + hours * 3600_000).toISOString(), ip, user_agent: ua });
  if (mfaDone) await db("user_touch_login", { id: userId });
  (await cookies()).set(SESSION_COOKIE, token, cookieOpts(hours * 3600));
}

export async function getSession(): Promise<Session | null> {
  if (!authConfigured()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db<Session | null>("session_get", { token_hash: sha256(token) });
  return s && !s.disabled ? s : null;
}

/** Marks the current session as fully signed in (after setup completes). */
export async function upgradeSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  await db("session_upgrade", { token_hash: sha256(token), expires_at: new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString() });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db("session_delete", { token_hash: sha256(token) });
  jar.delete(SESSION_COOKIE);
}

export async function setPending(userId: string): Promise<void> {
  (await cookies()).set(PENDING_COOKIE, sign({ uid: userId }, 600), cookieOpts(600));
}

export async function getPending(): Promise<string | null> {
  return unsign<{ uid: string }>((await cookies()).get(PENDING_COOKIE)?.value)?.uid ?? null;
}

export async function clearPending(): Promise<void> {
  (await cookies()).delete(PENDING_COOKIE);
}

export async function setChallenge(challenge: string, purpose: "login" | "register"): Promise<void> {
  (await cookies()).set(CHALLENGE_COOKIE, sign({ c: challenge, p: purpose }, 300), cookieOpts(300));
}

export async function takeChallenge(purpose: "login" | "register"): Promise<string | null> {
  const jar = await cookies();
  const v = unsign<{ c: string; p: string }>(jar.get(CHALLENGE_COOKIE)?.value);
  jar.delete(CHALLENGE_COOKIE);
  return v && v.p === purpose ? v.c : null;
}
