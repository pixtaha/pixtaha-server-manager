"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import type { AuthAdapter, AuthError, SignInResult, StepResult, TotpEnrollment } from "./types";

/** Real sign-in: every call goes to /api/auth/<action> (see app/api/auth/[action]/route.ts). */
async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  try {
    const res = await fetch(`/api/auth/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    return (await res.json()) as T;
  } catch {
    return { ok: false, error: { code: "unknown", message: "Network error. Check your connection." } } as T;
  }
}

function passkeyError(e: unknown): AuthError {
  if (e instanceof WebAuthnError || (e instanceof Error && e.name === "NotAllowedError")) return { code: "passkey_cancelled" };
  return { code: "passkey_unavailable" };
}

export const liveAuth: AuthAdapter = {
  sample: false,

  async passkeyAvailable() {
    return browserSupportsWebAuthn();
  },
  async signInWithPasskey(): Promise<SignInResult> {
    if (!browserSupportsWebAuthn()) return { ok: false, error: { code: "passkey_unavailable" } };
    const o = await call<{ ok: boolean; options?: unknown; error?: AuthError }>("passkey-options");
    if (!o.ok || !o.options) return { ok: false, error: o.error ?? { code: "unknown" } };
    try {
      const response = await startAuthentication({ optionsJSON: o.options as never });
      return await call<SignInResult>("passkey-verify", { response });
    } catch (e) {
      return { ok: false, error: passkeyError(e) };
    }
  },
  signInWithPassword: (email, password) => call<SignInResult>("password", { email, password }),
  verifyTotp: (_f, code, { trustDevice }) => call<SignInResult>("totp", { code, trustDevice }),
  verifyBackupCode: (_f, code, { trustDevice }) => call<SignInResult>("backup", { code, trustDevice }),

  acceptInvite: (invite, password) => call<StepResult>("invite", { invite, password }),
  async registerPasskey({ authenticator }): Promise<StepResult> {
    if (!browserSupportsWebAuthn()) return { ok: false, error: { code: "passkey_unavailable" } };
    const o = await call<{ ok: boolean; options?: unknown; error?: AuthError }>("register-options", { authenticator });
    if (!o.ok || !o.options) return { ok: false, error: o.error ?? { code: "unknown" } };
    try {
      const response = await startRegistration({ optionsJSON: o.options as never });
      const ua = navigator.userAgent;
      const name = /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Mac OS X/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : "Device";
      return await call<StepResult>("register-verify", { response, name: authenticator === "cross-platform" ? "Security key" : name });
    } catch (e) {
      return { ok: false, error: passkeyError(e) };
    }
  },
  async enrollTotp(): Promise<TotpEnrollment> {
    const r = await call<{ ok: boolean } & TotpEnrollment>("totp-start");
    if (!r.ok) throw new Error("Could not start authenticator setup");
    return { factorId: r.factorId, qrSvg: r.qrSvg, secret: r.secret, sample: false };
  },
  verifyTotpEnrollment: (_f, code) => call<StepResult>("totp-confirm", { code }),
  async createBackupCodes() {
    const r = await call<{ ok: boolean; codes?: string[] }>("backup-codes");
    return { codes: r.codes ?? [], sample: false };
  },
  async signOut() {
    await call("logout");
  },
};
