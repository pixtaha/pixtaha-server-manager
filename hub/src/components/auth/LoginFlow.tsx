"use client";

import { AlertTriangle, Clock, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/context";
import type { AuthError } from "@/lib/auth/types";
import { AuthHeading, AuthNotice } from "./AuthShell";
import { CodeInput, codeFromString, emptyCode } from "./CodeInput";

type Step = "passkey" | "unavailable" | "password" | "totp" | "backup";
export type LoginPreview = "wrong-code" | "rate-limited" | "no-passkey" | null;

const cairoHm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/**
 * Sign-in state machine: passkey (primary) -> password -> TOTP / backup code -> dashboard.
 * `preview` opens a review state directly (?state=wrong-code | rate-limited | no-passkey).
 */
export function LoginFlow({ preview, previewRetryAt }: { preview: LoginPreview; previewRetryAt: string }) {
  const auth = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>(preview === "no-passkey" ? "unavailable" : preview ? "totp" : "passkey");
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState("preview-factor");
  const [error, setErrorRaw] = useState<AuthError | null>(preview === "wrong-code" ? { code: "wrong_code", attemptsLeft: 2 } : null);
  /** Authenticator codes are locked until this time; backup codes keep working. */
  const [lockUntil, setLockUntil] = useState<string | null>(preview === "rate-limited" ? previewRetryAt : null);
  const setError = (e: AuthError | null) => {
    if (e?.code === "rate_limited") {
      setLockUntil(e.retryAt);
      setErrorRaw(null);
    } else setErrorRaw(e);
  };

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [digits, setDigits] = useState<string[]>(preview === "wrong-code" ? codeFromString("482193") : preview === "rate-limited" ? codeFromString("771") : emptyCode());
  const [backup, setBackup] = useState("");
  const [trust, setTrust] = useState(true);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };
  const done = () => router.push("/");

  // The lock lifts on its own when the time passes.
  useEffect(() => {
    if (!lockUntil) return;
    const t = setTimeout(() => setLockUntil(null), Math.max(0, Date.parse(lockUntil) - Date.now()));
    return () => clearTimeout(t);
  }, [lockUntil]);

  async function passkey() {
    setBusy(true);
    const r = await auth.signInWithPasskey();
    setBusy(false);
    if (r.ok) return r.next === "done" ? done() : (setFactorId(r.factorId), go("totp"));
    if (r.error.code === "passkey_unavailable") return go("unavailable");
    setError(r.error);
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await auth.signInWithPassword(email.trim(), password);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (r.next === "done") return done();
    setFactorId(r.factorId);
    setDigits(emptyCode());
    go("totp");
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = step === "backup" ? await auth.verifyBackupCode(factorId, backup, { trustDevice: trust }) : await auth.verifyTotp(factorId, digits.join(""), { trustDevice: trust });
    setBusy(false);
    if (r.ok) return done();
    setError(r.error);
  }

  const ids = { email: useId(), pw: useId(), err: useId(), backup: useId(), title: useId() };

  /* ---------------- passkey (primary) ---------------- */
  if (step === "passkey") {
    return (
      <section className="auth-step" aria-labelledby={ids.title}>
        <span className="auth-badge" aria-hidden><KeyRound size={22} strokeWidth={1.75} /></span>
        <AuthHeading id={ids.title} title="Sign in" text="Use the passkey on this device: Face ID, Touch ID or a security key." />
        {error ? <ErrorLine error={error} id={ids.err} /> : null}
        <div className="auth-actions">
          <button type="button" className="px-btn px-btn--primary px-btn--lg auth-wide" onClick={passkey} disabled={busy} aria-busy={busy}>
            {busy ? "Waiting for passkey…" : "Sign in with passkey"}
          </button>
          <button type="button" className="px-btn px-btn--ghost auth-wide" onClick={() => go("password")}>Use password instead</button>
        </div>
        <p className="auth-fine">Read-only access to your fleet. New operator? Open the invite link you received to set up access.</p>
      </section>
    );
  }

  /* ---------------- passkey not available ---------------- */
  if (step === "unavailable") {
    return (
      <section className="auth-step" aria-labelledby={ids.title}>
        <AuthHeading id={ids.title} title="Sign in" text="Use the passkey on this device: Face ID, Touch ID or a security key." />
        <AuthNotice tone="warning" icon={<AlertTriangle size={18} strokeWidth={1.75} aria-hidden />} title="Passkey not available on this device">
          This browser can&apos;t reach a passkey for this account. Use your password and authenticator code instead.
        </AuthNotice>
        <div className="auth-actions">
          <button type="button" className="px-btn px-btn--primary px-btn--lg auth-wide" onClick={() => go("password")}>Use password instead</button>
          <button type="button" className="px-btn px-btn--secondary auth-wide" onClick={passkey} disabled={busy} aria-busy={busy}>
            {busy ? "Waiting for passkey…" : "Try passkey again"}
          </button>
        </div>
      </section>
    );
  }

  /* ---------------- password fallback ---------------- */
  if (step === "password") {
    return (
      <form className="auth-step" aria-labelledby={ids.title} onSubmit={submitPassword} noValidate>
        <AuthHeading id={ids.title} title="Sign in with password" text="You'll confirm with your authenticator code next." />
        <div className="auth-fields">
          <div className="field">
            <label htmlFor={ids.email} className="field-label">Email</label>
            <input id={ids.email} className="field-input" type="email" dir="ltr" autoComplete="username webauthn" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
          </div>
          <div className="field">
            <label htmlFor={ids.pw} className="field-label">Password</label>
            <span className="pw-field">
              <input id={ids.pw} className="pw-input" type={showPw ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error?.code === "invalid_credentials" || undefined} aria-describedby={error ? ids.err : undefined} />
              <button type="button" className="pw-toggle" onClick={() => setShowPw((v) => !v)} aria-pressed={showPw} aria-controls={ids.pw}>
                {showPw ? "Hide" : "Show"}
              </button>
            </span>
          </div>
          {error ? <ErrorLine error={error} id={ids.err} /> : null}
        </div>
        <div className="auth-actions">
          <button type="submit" className="px-btn px-btn--primary px-btn--lg auth-wide" disabled={busy || !email || !password} aria-busy={busy}>
            {busy ? "Checking…" : "Continue"}
          </button>
          <button type="button" className="px-btn px-btn--ghost auth-wide" onClick={() => go("passkey")}>Sign in with passkey</button>
        </div>
      </form>
    );
  }

  /* ---------------- TOTP / backup code ---------------- */
  const isBackup = step === "backup";
  const locked = !!lockUntil && !isBackup;
  const complete = isBackup ? backup.trim().length >= 8 : digits.every(Boolean);
  return (
    <form className="auth-step" aria-labelledby={ids.title} onSubmit={submitCode} noValidate>
      <AuthHeading
        id={ids.title}
        title={locked ? "Sign-in paused" : isBackup ? "Use a backup code" : "Enter your 6-digit code"}
        text={
          isBackup
            ? "Enter one of the backup codes you saved during setup. Each code works once."
            : "Open Google Authenticator and enter the code for Pixtaha Management. You can paste all 6 digits at once."
        }
      />
      <div className="auth-code">
        {isBackup ? (
          <div className="field">
            <label htmlFor={ids.backup} className="field-label">Backup code</label>
            <input id={ids.backup} className="field-input mono-input" dir="ltr" autoComplete="one-time-code" placeholder="XXXX-XXXX" value={backup} onChange={(e) => { setBackup(e.target.value.toUpperCase()); if (error?.code === "wrong_code") setError(null); }} aria-invalid={error?.code === "wrong_code" || undefined} aria-describedby={error ? ids.err : undefined} autoFocus />
          </div>
        ) : (
          <CodeInput
            value={digits}
            onChange={(d) => {
              setDigits(d);
              if (error?.code === "wrong_code") setError(null);
            }}
            invalid={error?.code === "wrong_code"}
            disabled={locked}
            describedBy={error ? ids.err : undefined}
            autoFocus={!preview}
          />
        )}
        {locked ? (
          <AuthNotice tone="danger" icon={<Clock size={18} strokeWidth={1.75} aria-hidden />} title="Too many attempts. Try again in 5 minutes.">
            Unlocks at <span dir="ltr" className="mono">{cairoHm(lockUntil!)}</span> Cairo time. Your backup codes still work.
          </AuthNotice>
        ) : error ? (
          <ErrorLine error={error} id={ids.err} />
        ) : null}
      </div>
      <label className="auth-check">
        <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
        <span>Trust this device for 30 days</span>
      </label>
      <div className="auth-actions">
        <button type="submit" className="px-btn px-btn--primary px-btn--lg auth-wide" disabled={busy || locked || !complete} aria-busy={busy}>
          {busy ? "Verifying…" : "Verify"}
        </button>
        <button
          type="button"
          className="px-btn px-btn--ghost auth-wide"
          onClick={() => go(isBackup ? "totp" : "backup")}
        >
          {isBackup ? "Use authenticator code" : "Use a backup code"}
        </button>
      </div>
    </form>
  );
}

function ErrorLine({ error, id }: { error: AuthError; id: string }) {
  const text =
    error.code === "wrong_code"
      ? `That code didn't match. Check the time on your phone and try again. ${error.attemptsLeft} attempt${error.attemptsLeft === 1 ? "" : "s"} left.`
      : error.code === "invalid_credentials"
        ? "Email or password is not correct."
        : error.code === "passkey_cancelled"
          ? "Passkey sign-in was cancelled. Try again or use your password."
          : error.code === "unknown"
            ? error.message ?? "Something went wrong. Try again."
            : null;
  if (!text) return null;
  return (
    <div id={id} role="alert" className="auth-error">
      <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
      <span>{text}</span>
    </div>
  );
}
