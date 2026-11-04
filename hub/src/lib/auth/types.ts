/**
 * Auth contract between the login UI and whatever backs it.
 *
 * `liveAuth` (live-adapter.ts) talks to /api/auth/* (hub-owned accounts in server_manager, passkeys
 * via WebAuthn, TOTP, backup codes). `sampleAuth` is the UI-only stand-in used when sign-in is not
 * configured (local previews).
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
  /** One-time invite link: creates the admin account with this password and signs in for setup. */
  acceptInvite(invite: string, password: string): Promise<StepResult>;
  registerPasskey(opts: { authenticator: "platform" | "cross-platform" }): Promise<StepResult>;
  enrollTotp(): Promise<TotpEnrollment>;
  verifyTotpEnrollment(factorId: string, code: string): Promise<StepResult>;
  /** Generates fresh one-time backup codes. Shown once, never stored in the client. */
  createBackupCodes(): Promise<{ codes: string[]; sample: boolean }>;
  signOut(): Promise<void>;
}
