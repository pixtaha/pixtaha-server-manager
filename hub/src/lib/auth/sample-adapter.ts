import type { AuthAdapter, SignInResult } from "./types";

/**
 * UI-only adapter: no network, no secrets, nothing persisted.
 * - Any email + password moves to the code step.
 * - Code 000000 is "wrong"; 3 wrong codes trigger the 5-minute rate limit. Any other 6 digits succeed.
 * - Backup code 0000-0000 is "wrong"; any other XXXX-XXXX succeeds, even during the TOTP lock.
 * - Passkeys fail with passkey_unavailable when the browser has no WebAuthn support.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_ATTEMPTS = 3;
const LOCK_MS = 5 * 60 * 1000;

let failures = 0;
let lockedUntil = 0;

function codeResult(ok: boolean, lockable = true): SignInResult {
  if (lockable && Date.now() < lockedUntil) return { ok: false, error: { code: "rate_limited", retryAt: new Date(lockedUntil).toISOString() } };
  if (ok) {
    failures = 0;
    return { ok: true, next: "done" };
  }
  failures += 1;
  if (failures >= MAX_ATTEMPTS) {
    lockedUntil = Date.now() + LOCK_MS;
    failures = 0;
    return { ok: false, error: { code: "rate_limited", retryAt: new Date(lockedUntil).toISOString() } };
  }
  return { ok: false, error: { code: "wrong_code", attemptsLeft: MAX_ATTEMPTS - failures } };
}

const hasWebAuthn = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";

/** Fictional values, clearly not real: the secret spells "SAMPLE KEY NOT REAL". */
const SAMPLE_SECRET = "SAMP LEKE YNOT REAL 7Q2K";
const SAMPLE_CODES = ["4F7K-92QD", "HX3M-7RTP", "Q8WN-2JDE", "B5CZ-K91L", "T6YV-3MHA", "N2PG-8XKE", "R7JD-5QWF", "L9AE-6TNC", "W3HU-4BZR", "E8KS-1VPM"];

export const sampleAuth: AuthAdapter = {
  sample: true,

  async passkeyAvailable() {
    return hasWebAuthn();
  },
  async signInWithPasskey() {
    await wait(500);
    if (!hasWebAuthn()) return { ok: false, error: { code: "passkey_unavailable" } };
    return { ok: true, next: "done" };
  },
  async signInWithPassword(email, password) {
    await wait(400);
    if (!email.includes("@") || !password) return { ok: false, error: { code: "invalid_credentials" } };
    return { ok: true, next: "mfa", factorId: "sample-totp-factor" };
  },
  async verifyTotp(_factorId, code) {
    await wait(400);
    return codeResult(code !== "000000");
  },
  async verifyBackupCode(_factorId, code) {
    await wait(400);
    // Backup codes are the way out of a TOTP lock, so they are not locked themselves.
    if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(code.trim()) || code.trim().toUpperCase() === "0000-0000") return { ok: false, error: { code: "wrong_code", attemptsLeft: 2 } };
    return codeResult(true, false);
  },

  async registerPasskey() {
    await wait(500);
    if (!hasWebAuthn()) return { ok: false, error: { code: "passkey_unavailable" } };
    return { ok: true };
  },
  async enrollTotp() {
    await wait(200);
    return { factorId: "sample-totp-factor", qrSvg: null, secret: SAMPLE_SECRET, sample: true };
  },
  async verifyTotpEnrollment(_factorId, code) {
    await wait(400);
    return code === "000000" ? { ok: false, error: { code: "wrong_code", attemptsLeft: 2 } } : { ok: true };
  },
  async createBackupCodes() {
    return { codes: SAMPLE_CODES, sample: true };
  },
};
