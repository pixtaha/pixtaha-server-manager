/**
 * Auth contract between the login UI and whatever backs it.
 *
 * Today: `sampleAuth` (sample-adapter.ts), UI only, no real sign-in.
 * Next:  a Supabase adapter (password + TOTP MFA via supabase.auth.mfa.*) plus WebAuthn passkeys
 *        (navigator.credentials.get / create with options from the server). The screens only talk to
 *        this interface, so swapping the adapter needs no UI changes.
 */

export type AuthError =
  | { code: "invalid_credentials" }
  | { code: "wrong_code"; attemptsLeft: number }
  | { code: "rate_limited"; retryAt: string }
  | { code: "passkey_unavailable" }
  | { code: "passkey_cancelled" }
  | { code: "unknown"; message?: string };

/** Result of a sign-in step. `mfa` means a TOTP (or backup code) challenge must follow. */
export type SignInResult = { ok: true; next: "done" } | { ok: true; next: "mfa"; factorId: string } | { ok: false; error: AuthError };

export type StepResult = { ok: true } | { ok: false; error: AuthError };

export interface TotpEnrollment {
  factorId: string;
  /** SVG markup of the otpauth:// QR code, or null when only a placeholder is available (sample). */
  qrSvg: string | null;
  /** Base32 secret for manual entry, grouped in blocks of 4. */
  secret: string;
  sample: boolean;
}

export interface AuthAdapter {
  /** True when the sample adapter is in use: the UI marks values and screens as sample. */
  readonly sample: boolean;

  // ---- sign in
  /** Whether this browser can use a platform or roaming passkey at all. */
  passkeyAvailable(): Promise<boolean>;
  signInWithPasskey(): Promise<SignInResult>;
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  verifyTotp(factorId: string, code: string, opts: { trustDevice: boolean }): Promise<SignInResult>;
  verifyBackupCode(factorId: string, code: string, opts: { trustDevice: boolean }): Promise<SignInResult>;

  // ---- first-time setup
  registerPasskey(opts: { authenticator: "platform" | "cross-platform" }): Promise<StepResult>;
  enrollTotp(): Promise<TotpEnrollment>;
  verifyTotpEnrollment(factorId: string, code: string): Promise<StepResult>;
  /** Generates fresh one-time backup codes. Shown once, never stored in the client. */
  createBackupCodes(): Promise<{ codes: string[]; sample: boolean }>;
}
