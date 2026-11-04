"use client";

import { AlertTriangle, Check, Copy, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/context";
import type { AuthError, TotpEnrollment } from "@/lib/auth/types";
import { AuthHeading, AuthNotice, SampleTag } from "./AuthShell";
import { CodeInput, emptyCode } from "./CodeInput";

/** 0 = choose a password (invite link only), then 1 passkey, 2 authenticator, 3 backup codes. */
export type SetupStep = 0 | 1 | 2 | 3;
const STEP_NAME = ["", "Passkey", "Authenticator", "Backup codes"];

/** "MacBook · Safari" style label from the user agent, read after mount. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "This device";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

/**
 * First-time setup: 1 register passkey, 2 authenticator (TOTP), 3 backup codes.
 * `initialStep` lets reviewers open a step directly (/login/setup?step=2).
 */
export function SetupFlow({ account, initialStep, invite }: { account: string; initialStep: SetupStep; invite?: string }) {
  const auth = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [device, setDevice] = useState("This device");

  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [reveal, setReveal] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [digits, setDigits] = useState<string[]>(emptyCode());

  const [codes, setCodes] = useState<string[] | null>(null);
  const [codesSample, setCodesSample] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const pwProblem = pw.length > 0 && pw.length < 12 ? "Use at least 12 characters." : pw2.length > 0 && pw !== pw2 ? "The two passwords don't match." : null;

  const ids = { title: useId(), err: useId(), saved: useId() };

  useEffect(() => setDevice(deviceLabel()), []);
  useEffect(() => {
    if (step === 2 && !enrollment) auth.enrollTotp().then(setEnrollment);
    if (step === 3 && !codes)
      auth.createBackupCodes().then((r) => {
        setCodes(r.codes);
        setCodesSample(r.sample);
      });
  }, [step, enrollment, codes, auth]);

  const next = (s: SetupStep) => {
    setError(null);
    setStep(s);
  };

  async function createPassword(e: FormEvent) {
    e.preventDefault();
    if (!invite || pw.length < 12 || pw !== pw2) return;
    setBusy(true);
    const r = await auth.acceptInvite(invite, pw);
    setBusy(false);
    if (r.ok) {
      setPw("");
      setPw2("");
      return next(1);
    }
    setError(r.error);
  }

  async function createPasskey(kind: "platform" | "cross-platform") {
    setBusy(true);
    const r = await auth.registerPasskey({ authenticator: kind });
    setBusy(false);
    if (r.ok) return next(2);
    setError(r.error);
  }

  async function verifyTotp(e: FormEvent) {
    e.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    const r = await auth.verifyTotpEnrollment(enrollment.factorId, digits.join(""));
    setBusy(false);
    if (r.ok) return next(3);
    setError(r.error);
  }

  const codesText = (list: string[]) =>
    [
      "Pixtaha Management · backup codes",
      `Account: ${account}`,
      codesSample ? "SAMPLE CODES: generated for review, they do not work." : "Each code works once. Keep this file somewhere safe.",
      "",
      ...list.map((c, i) => `${String(i + 1).padStart(2, "0")}  ${c}`),
      "",
    ].join("\n");

  async function copyCodes() {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codesText(codes));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: Download still works */
    }
  }

  function downloadCodes() {
    if (!codes) return;
    const url = URL.createObjectURL(new Blob([codesText(codes)], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = codesSample ? "pixtaha-backup-codes-SAMPLE.txt" : "pixtaha-backup-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const secret = enrollment?.secret ?? "";
  const maskedSecret = secret ? `${secret.slice(0, 4)} •••• •••• •••• ${secret.slice(-4)}` : "•••• •••• •••• •••• ••••";

  return (
    <div className="auth-step">
      {/* ---------------- 0 · password (invite link) ---------------- */}
      {step === 0 ? (
        <form className="auth-step" aria-labelledby={ids.title} onSubmit={createPassword} noValidate>
          <AuthHeading id={ids.title} title="Create your password" text="This link works once. Your password is the fallback when a passkey isn't available." />
          <dl className="setup-facts">
            <div><dt>Account</dt><dd dir="ltr">{account}</dd></div>
          </dl>
          <div className="auth-fields">
            <input type="email" autoComplete="username" value={account} readOnly hidden />
            <div className="field">
              <label htmlFor={`${ids.title}-pw`} className="field-label">Password</label>
              <input id={`${ids.title}-pw`} className="field-input" type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setError(null); }} minLength={12} required autoFocus aria-describedby={pwProblem || error ? ids.err : undefined} />
            </div>
            <div className="field">
              <label htmlFor={`${ids.title}-pw2`} className="field-label">Repeat password</label>
              <input id={`${ids.title}-pw2`} className="field-input" type="password" dir="ltr" autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setError(null); }} required />
            </div>
          </div>
          {pwProblem || error ? (
            <div id={ids.err} role="alert" className="auth-error">
              <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
              <span>{pwProblem ?? (error?.code === "invalid_credentials" ? "This invite link is not valid any more." : error?.code === "rate_limited" ? "Too many tries. Wait a few minutes." : (error && "message" in error && error.message) || "Something went wrong. Try again.")}</span>
            </div>
          ) : null}
          <button type="submit" className="px-btn px-btn--primary px-btn--lg auth-wide" disabled={busy || pw.length < 12 || pw !== pw2} aria-busy={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
      ) : null}

      {step > 0 ? (
      <div className="setup-progress">
        <div className="setup-progress-text">
          <span>Step <span dir="ltr">{step}</span> of 3</span>
          <span>{STEP_NAME[step]}</span>
        </div>
        <div className="setup-bars" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-valuetext={`Step ${step} of 3: ${STEP_NAME[step]}`}>
          {[1, 2, 3].map((n) => <span key={n} className={n <= step ? "is-on" : ""} />)}
        </div>
      </div>
      ) : null}

      {/* ---------------- 1 · passkey ---------------- */}
      {step === 1 ? (
        <section className="auth-step" aria-labelledby={ids.title}>
          <AuthHeading id={ids.title} title="Register a passkey" text="Your passkey becomes the fastest way in. It stays on this device and never leaves it." />
          <dl className="setup-facts">
            <div><dt>Account</dt><dd dir="ltr">{account}</dd></div>
            <div><dt>This device</dt><dd>{device}</dd></div>
          </dl>
          {error?.code === "passkey_unavailable" ? (
            <AuthNotice tone="warning" icon={<AlertTriangle size={18} strokeWidth={1.75} aria-hidden />} title="Passkey not available on this device">
              Use a security key, or continue and sign in with password + authenticator code.
            </AuthNotice>
          ) : null}
          <div className="auth-actions">
            <button type="button" className="px-btn px-btn--primary px-btn--lg auth-wide" onClick={() => createPasskey("platform")} disabled={busy} aria-busy={busy}>
              {busy ? "Waiting for passkey…" : "Create passkey"}
            </button>
            <button type="button" className="px-btn px-btn--ghost auth-wide" onClick={() => createPasskey("cross-platform")} disabled={busy}>Use a security key</button>
            {error?.code === "passkey_unavailable" || error?.code === "passkey_cancelled" ? (
              <button type="button" className="px-btn px-btn--ghost auth-wide" onClick={() => next(2)}>Skip for now</button>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ---------------- 2 · authenticator ---------------- */}
      {step === 2 ? (
        <form className="auth-step" aria-labelledby={ids.title} onSubmit={verifyTotp} noValidate>
          <AuthHeading id={ids.title} title="Set up your authenticator" text="Scan this code with Google Authenticator, then enter the 6 digits it shows." />
          <div className="totp-setup">
            <div className="qr" role="img" aria-label={enrollment?.sample !== false ? "Sample QR code placeholder" : "QR code for your authenticator app"}>
              {enrollment?.qrSvg ? (
                // Real adapter: server-rendered SVG of the otpauth:// URI.
                <span className="qr-svg" dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }} />
              ) : (
                <>
                  <span className="mono">QR code</span>
                  <SampleTag />
                </>
              )}
            </div>
            <div className="totp-key">
              <span className="subtle" style={{ fontSize: 13 }}>Can&apos;t scan? Enter this key</span>
              <span dir="ltr" className="totp-secret" aria-live="polite">{reveal ? secret : maskedSecret}</span>
              <div className="totp-key-actions">
                <button type="button" className="px-btn px-btn--secondary px-btn--sm" onClick={() => setReveal((v) => !v)} aria-pressed={reveal} disabled={!secret}>
                  {reveal ? "Hide" : "Reveal"}
                </button>
                <button
                  type="button"
                  className="px-btn px-btn--ghost px-btn--sm"
                  disabled={!secret}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(secret.replace(/\s/g, ""));
                      setKeyCopied(true);
                      setTimeout(() => setKeyCopied(false), 1600);
                    } catch {
                      setReveal(true);
                    }
                  }}
                >
                  {keyCopied ? <Check size={16} strokeWidth={2} aria-hidden /> : null}
                  {keyCopied ? "Copied" : "Copy"}
                </button>
              </div>
              {enrollment?.sample ? <span className="sample-line"><SampleTag /> Sample key for review. It does not pair with any account.</span> : null}
            </div>
          </div>
          <div className="auth-code">
            <span className="field-label" id={`${ids.title}-code`}>Verification code</span>
            <CodeInput value={digits} onChange={(d) => { setDigits(d); setError(null); }} size="md" label="Verification code" invalid={error?.code === "wrong_code"} describedBy={error ? ids.err : undefined} />
            {error?.code === "wrong_code" ? (
              <div id={ids.err} role="alert" className="auth-error">
                <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
                <span>That code didn&apos;t match. Check the time on your phone and try again.</span>
              </div>
            ) : null}
          </div>
          <button type="submit" className="px-btn px-btn--primary px-btn--lg auth-wide" disabled={busy || !enrollment || !digits.every(Boolean)} aria-busy={busy}>
            {busy ? "Verifying…" : "Verify and continue"}
          </button>
        </form>
      ) : null}

      {/* ---------------- 3 · backup codes ---------------- */}
      {step === 3 ? (
        <section className="auth-step" aria-labelledby={ids.title}>
          <AuthHeading id={ids.title} title="Save your backup codes" text="Each code works once if you lose your phone. This is the only time you'll see them." />
          <div className="codes-wrap">
            {codesSample ? <span className="codes-sample"><SampleTag>Sample codes</SampleTag></span> : null}
            <ol className="codes" dir="ltr" aria-label="Backup codes">
              {(codes ?? Array.from({ length: 10 }, () => "••••-••••")).map((c, i) => (
                <li key={i}>
                  <span className="codes-n">{String(i + 1).padStart(2, "0")}</span>
                  <span>{c}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="codes-actions">
            <button type="button" className="px-btn px-btn--secondary px-btn--sm" onClick={copyCodes} disabled={!codes}>
              {copied ? <Check size={16} strokeWidth={2} aria-hidden /> : <Copy size={16} strokeWidth={1.75} aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="px-btn px-btn--secondary px-btn--sm" onClick={downloadCodes} disabled={!codes}>
              <Download size={16} strokeWidth={1.75} aria-hidden /> Download .txt
            </button>
            <span className="sr-only" aria-live="polite">{copied ? "Backup codes copied" : ""}</span>
          </div>
          <label className="auth-check auth-check--rule">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} aria-describedby={ids.saved} />
            <span>I saved these codes somewhere safe</span>
          </label>
          <span id={ids.saved} className="sr-only">Required before you can finish setup.</span>
          <button type="button" className="px-btn px-btn--primary px-btn--lg auth-wide" disabled={!saved} onClick={() => router.push("/")}>
            Finish setup
          </button>
        </section>
      ) : null}
    </div>
  );
}
