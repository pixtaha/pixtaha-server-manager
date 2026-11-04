import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import {
  authConfigured,
  clearPending,
  clientInfo,
  createSession,
  db,
  decrypt,
  destroySession,
  encrypt,
  getPending,
  getSession,
  hashPassword,
  newBackupCodes,
  newTotpSecret,
  normalizeBackup,
  rateCheck,
  rateHit,
  safeEqual,
  setChallenge,
  setPending,
  sha256,
  takeChallenge,
  upgradeSession,
  verifyPassword,
  verifyTotp,
  type HubUser,
} from "@/lib/auth/server";

/**
 * Dashboard login API. One route, the action is the last path segment:
 *   password, totp, backup, passkey-options, passkey-verify, logout,
 *   invite, register-options, register-verify, totp-start, totp-confirm, backup-codes.
 * Responses follow lib/auth/types.ts (SignInResult / StepResult).
 */

const RP_NAME = "Pixtaha Management";
const LOGIN_MAX = 10, LOGIN_WINDOW = 15 * 60;   // per IP and per email
const CODE_MAX = 5, CODE_WINDOW = 5 * 60;       // per user, authenticator codes (UI says 5 minutes)
const BACKUP_MAX = 10, BACKUP_WINDOW = 60 * 60; // per user, backup codes

const ok = (body: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...body });
const fail = (error: Record<string, unknown>, status = 200) => NextResponse.json({ ok: false, error }, { status });
const limited = (retryAt: string) => fail({ code: "rate_limited", retryAt });

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  if (!authConfigured()) return fail({ code: "unknown", message: "Sign-in is not configured" }, 503);
  const { action } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    switch (action) {
      case "password": return await password(String(body.email ?? ""), String(body.password ?? ""));
      case "totp": return await totp(String(body.code ?? ""), Boolean(body.trustDevice));
      case "backup": return await backup(String(body.code ?? ""), Boolean(body.trustDevice));
      case "passkey-options": return await passkeyOptions();
      case "passkey-verify": return await passkeyVerify(body.response);
      case "logout": await destroySession(); return ok();
      case "invite": return await invite(String(body.invite ?? ""), String(body.password ?? ""));
      case "register-options": return await registerOptions(body.authenticator === "cross-platform" ? "cross-platform" : "platform");
      case "register-verify": return await registerVerify(body.response, String(body.name ?? ""));
      case "totp-start": return await totpStart();
      case "totp-confirm": return await totpConfirm(String(body.code ?? ""));
      case "backup-codes": return await backupCodes();
      default: return fail({ code: "unknown", message: "Unknown action" }, 404);
    }
  } catch (e) {
    console.error(`auth ${action} failed:`, e instanceof Error ? e.message : e);
    return fail({ code: "unknown", message: "Something went wrong. Try again." }, 500);
  }
}

// ------------------------------------------------------------------ sign in

async function password(email: string, pw: string) {
  const { ip } = await clientInfo();
  const byIp = await rateHit(`login:ip:${ip}`, LOGIN_MAX, LOGIN_WINDOW);
  const byEmail = await rateHit(`login:email:${email.toLowerCase()}`, LOGIN_MAX, LOGIN_WINDOW);
  if (byIp.limited || byEmail.limited) return limited(byIp.limited ? byIp.retryAt : byEmail.retryAt);

  const user = await db<HubUser | null>("user_by_email", { email });
  const valid = await verifyPassword(pw, user?.password_hash ?? null);
  if (!user || !valid || user.disabled) return fail({ code: "invalid_credentials" });

  await db("rate_clear", { key: `login:email:${email.toLowerCase()}` });
  if (user.totp_enabled) {
    await setPending(user.id);
    return ok({ next: "mfa", factorId: "totp" });
  }
  // Password alone never opens the dashboard: without an authenticator the session can only finish setup.
  await createSession(user.id, false);
  return ok({ next: "done" });
}

async function pendingUser(): Promise<HubUser | null> {
  const id = await getPending();
  return id ? db<HubUser | null>("user_by_id", { id }) : null;
}

async function totp(code: string, trust: boolean) {
  const user = await pendingUser();
  if (!user || !user.totp_secret_enc) return fail({ code: "invalid_credentials" });
  const key = `totp:user:${user.id}`;
  const lock = await rateCheck(key, CODE_MAX, CODE_WINDOW);
  if (lock.limited) return limited(lock.retryAt);
  if (!verifyTotp(decrypt(user.totp_secret_enc), code)) {
    // the CODE_MAX-th wrong code locks authenticator codes for the window
    const r = await rateHit(key, CODE_MAX - 1, CODE_WINDOW);
    if (r.limited) return limited(r.retryAt);
    return fail({ code: "wrong_code", attemptsLeft: CODE_MAX - r.count });
  }
  await db("rate_clear", { key });
  await clearPending();
  await createSession(user.id, true, trust);
  return ok({ next: "done" });
}

async function backup(code: string, trust: boolean) {
  const user = await pendingUser();
  if (!user) return fail({ code: "invalid_credentials" });
  // Backup codes are the way out of an authenticator lock, so they have their own, looser limit.
  const key = `backup:user:${user.id}`;
  const r = await rateHit(key, BACKUP_MAX, BACKUP_WINDOW);
  if (r.limited) return limited(r.retryAt);
  const used = await db<boolean>("backup_code_use", { id: user.id, hash: sha256(normalizeBackup(code)) });
  if (!used) return fail({ code: "wrong_code", attemptsLeft: Math.max(1, BACKUP_MAX - r.count) });
  await clearPending();
  await createSession(user.id, true, trust);
  return ok({ next: "done" });
}

async function passkeyOptions() {
  const { rpID } = await clientInfo();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: [] });
  await setChallenge(options.challenge, "login");
  return ok({ options });
}

async function passkeyVerify(response: unknown) {
  const { ip, origin, rpID } = await clientInfo();
  const r = await rateHit(`passkey:ip:${ip}`, LOGIN_MAX * 2, LOGIN_WINDOW);
  if (r.limited) return limited(r.retryAt);
  const challenge = await takeChallenge("login");
  const resp = response as { id?: string } | null;
  if (!challenge || !resp?.id) return fail({ code: "passkey_cancelled" });
  const cred = await db<{ id: string; user_id: string; public_key: string; counter: number; transports: string[] } | null>("passkey_get", { cred_id: resp.id });
  if (!cred) return fail({ code: "invalid_credentials" });
  const v = await verifyAuthenticationResponse({
    response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: cred.id, publicKey: Buffer.from(cred.public_key, "base64url"), counter: Number(cred.counter), transports: cred.transports as never },
  });
  if (!v.verified) return fail({ code: "invalid_credentials" });
  await db("passkey_touch", { cred_id: cred.id, counter: v.authenticationInfo.newCounter });
  const user = await db<HubUser | null>("user_by_id", { id: cred.user_id });
  if (!user || user.disabled) return fail({ code: "invalid_credentials" });
  // A passkey with user verification is two factors in one; it opens a full session.
  await createSession(user.id, true);
  return ok({ next: "done" });
}

// ------------------------------------------------------------------ first-time setup

async function invite(token: string, pw: string) {
  const { ip } = await clientInfo();
  const r = await rateHit(`invite:ip:${ip}`, 10, 60 * 60);
  if (r.limited) return limited(r.retryAt);
  const expected = process.env.HUB_INVITE_TOKEN ?? "";
  const email = (process.env.HUB_ADMIN_EMAIL ?? "").toLowerCase();
  if (!expected || !email || !safeEqual(sha256(token), sha256(expected))) return fail({ code: "invalid_credentials" });
  if (pw.length < 12) return fail({ code: "unknown", message: "Use at least 12 characters." });
  const existing = await db<HubUser | null>("user_by_email", { email });
  // The invite only creates the account once. After that it is dead, even if the env var stays.
  if (existing) return fail({ code: "invalid_credentials" });
  const user = await db<HubUser>("user_create", { email, password_hash: await hashPassword(pw) });
  await createSession(user.id, false);
  return ok();
}

/** Setup steps need a session; once setup is done they need a full (MFA) session. */
async function setupSession() {
  const s = await getSession();
  if (!s) return null;
  if (s.mfa_done || !s.totp_enabled) return s;
  return null;
}

async function registerOptions(kind: "platform" | "cross-platform") {
  const s = await setupSession();
  if (!s) return fail({ code: "invalid_credentials" }, 401);
  const { rpID } = await clientInfo();
  const existing = await db<{ id: string; transports: string[] }[]>("passkeys_for_user", { user_id: s.user_id });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: s.email,
    userID: new TextEncoder().encode(s.user_id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports as never })),
    authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: kind },
  });
  await setChallenge(options.challenge, "register");
  return ok({ options });
}

async function registerVerify(response: unknown, name: string) {
  const s = await setupSession();
  if (!s) return fail({ code: "invalid_credentials" }, 401);
  const { origin, rpID } = await clientInfo();
  const challenge = await takeChallenge("register");
  if (!challenge) return fail({ code: "passkey_cancelled" });
  const v = await verifyRegistrationResponse({
    response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!v.verified) return fail({ code: "passkey_cancelled" });
  const c = v.registrationInfo.credential;
  await db("passkey_add", {
    cred_id: c.id,
    user_id: s.user_id,
    public_key: Buffer.from(c.publicKey).toString("base64url"),
    counter: c.counter,
    transports: c.transports ?? [],
    name: name.slice(0, 60) || null,
  });
  return ok();
}

async function totpStart() {
  const s = await setupSession();
  if (!s) return fail({ code: "invalid_credentials" }, 401);
  // Re-running setup on an account that already has an authenticator would let a half-signed-in
  // session replace it, so this only works before the first authenticator is confirmed.
  if (s.totp_enabled) return fail({ code: "unknown", message: "Authenticator already set up" }, 409);
  const secret = newTotpSecret();
  await db("totp_set", { id: s.user_id, secret_enc: encrypt(secret), enabled: false });
  // SHA-1 / 6 digits / 30 s are the defaults, so they stay out of the URI to keep the QR code small.
  const uri = `otpauth://totp/${encodeURIComponent(`Pixtaha:${s.email}`)}?secret=${secret}&issuer=Pixtaha`;
  // Dark modules on white with a 4-module quiet zone: phone cameras need both to read the code.
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 4, errorCorrectionLevel: "L", color: { dark: "#000000", light: "#ffffff" } });
  return ok({ factorId: "totp", qrSvg, secret: secret.match(/.{1,4}/g)!.join(" "), sample: false });
}

async function totpConfirm(code: string) {
  const s = await setupSession();
  if (!s) return fail({ code: "invalid_credentials" }, 401);
  const key = `totp-setup:user:${s.user_id}`;
  const r = await rateHit(key, 10, CODE_WINDOW);
  if (r.limited) return limited(r.retryAt);
  const user = await db<HubUser | null>("user_by_id", { id: s.user_id });
  if (!user?.totp_secret_enc || !verifyTotp(decrypt(user.totp_secret_enc), code)) return fail({ code: "wrong_code", attemptsLeft: 3 });
  await db("totp_set", { id: s.user_id, secret_enc: user.totp_secret_enc, enabled: true });
  await db("rate_clear", { key });
  return ok();
}

async function backupCodes() {
  const s = await getSession();
  // Allowed right after the authenticator is confirmed (still in setup) or from a full session.
  if (!s || !s.totp_enabled) return fail({ code: "invalid_credentials" }, 401);
  const codes = newBackupCodes();
  await db("backup_codes_replace", { id: s.user_id, hashes: codes.map((c) => sha256(normalizeBackup(c))) });
  await upgradeSession();
  return ok({ codes, sample: false });
}
