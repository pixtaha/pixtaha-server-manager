"use client";

import { ArrowRight, Check, ChevronDown, Copy, Loader } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { StatusIcon, StatusPill } from "@/components/StatusPill";
import type { Env } from "@/lib/types";

/*
 * Add server, ported from docs/design/dashboard-app.dc.html (pg.add).
 * No backend yet: the token is a fake value generated in the browser and clearly marked as sample.
 */

/** Placeholder installer URL. `.example` is reserved, so it can never point at a real host. */
const INSTALL_URL = "https://get.pixtaha.example/agent";
const TOKEN_TTL_MS = 30 * 60 * 1000;
const NEW_CLIENT = "__new";
const ENVS: Env[] = ["production", "demo", "dev"];
/** Hostname-style: lowercase letters, digits and dashes; no dash at either end. */
const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SAMPLE_NAME = "souq-sahel-api";

function sampleToken(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return `pmt_sample_${Array.from(bytes, (b) => abc[b % abc.length]).join("")}`;
}

const mask = (t: string) => `${t.slice(0, 11)}${"•".repeat(12)}${t.slice(-3)}`;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const cairoClock = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export function AddServerView({
  clients,
  hostnames,
  step,
  previewName,
  now,
}: {
  clients: string[];
  hostnames: string[];
  step: "waiting" | "success";
  previewName?: string;
  now: string;
}) {
  const ids = { name: useId(), nameHelp: useId(), client: useId(), newClient: useId(), env: useId() };
  const [name, setName] = useState(step === "success" ? (previewName && NAME_RE.test(previewName) ? previewName : SAMPLE_NAME) : "");
  const [touched, setTouched] = useState(false);
  const [client, setClient] = useState(clients[0] ?? NEW_CLIENT);
  const [newClient, setNewClient] = useState("");
  const [env, setEnv] = useState<Env>("production");

  // The token is created after mount, so server and client HTML match (no random value during SSR).
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [clock, setClock] = useState<number>(() => Date.parse(now));
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const newToken = () => {
    setToken(sampleToken());
    setExpiresAt(Date.now() + TOKEN_TTL_MS);
    setClock(Date.now());
    setRevealed(false);
  };
  useEffect(() => {
    newToken();
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nameError = !name ? "Enter a server name." : !NAME_RE.test(name) ? "Use lowercase letters, digits and dashes only." : hostnames.includes(name) && step !== "success" ? "A server with this name is already in the fleet." : null;
  const clientName = client === NEW_CLIENT ? newClient.trim() : client;
  const ready = !nameError && !!clientName;
  const left = expiresAt == null ? TOKEN_TTL_MS : expiresAt - clock;
  const expired = expiresAt != null && left <= 0;
  const enabled = ready && !!token && !expired;

  const command = (t: string) => `curl -fsSL ${INSTALL_URL} | sudo sh -s -- --token ${t}`;
  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(command(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: reveal the token so it can be selected by hand.
      setRevealed(true);
    }
  };

  return (
    <div className="stack add">
      <div className="add-head">
        <h1 className="page-title">Add server</h1>
        <span className="muted">The agent is read-only. It reports and never changes anything on the server.</span>
      </div>

      <div className="add-grid">
        {/* ---------- 1 · details ---------- */}
        <section className="add-card" aria-labelledby="add-details">
          <h2 id="add-details" className="px-eyebrow add-step">1 · Details</h2>

          <div className="field">
            <label htmlFor={ids.name} className="field-label">Server name</label>
            <input
              id={ids.name}
              className="field-input mono-input"
              dir="ltr"
              value={name}
              placeholder={SAMPLE_NAME}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              aria-invalid={touched && !!nameError}
              aria-describedby={ids.nameHelp}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
            />
            <span id={ids.nameHelp} className="field-help">
              {touched && nameError ? (
                <span className="field-error"><StatusIcon status="critical" size={13} />{nameError}</span>
              ) : (
                "Lowercase, as it should appear in reports."
              )}
            </span>
          </div>

          <div className="field">
            <label htmlFor={ids.client} className="field-label">Client</label>
            <span className="field-select">
              <select id={ids.client} className="field-input" value={client} onChange={(e) => setClient(e.target.value)}>
                {clients.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value={NEW_CLIENT}>+ New client</option>
              </select>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
            </span>
          </div>
          {client === NEW_CLIENT ? (
            <div className="field">
              <label htmlFor={ids.newClient} className="field-label">New client name</label>
              <input id={ids.newClient} className="field-input" value={newClient} placeholder="Client name" autoComplete="off" onChange={(e) => setNewClient(e.target.value)} />
            </div>
          ) : null}

          <fieldset className="field seg-field">
            <legend className="field-label">Environment</legend>
            <div className="seg">
              {ENVS.map((e) => (
                <label key={e} className="seg-opt">
                  <input type="radio" name={ids.env} value={e} checked={env === e} onChange={() => setEnv(e)} />
                  <span>{e}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        {/* ---------- 2 · install ---------- */}
        <section className="add-card" aria-labelledby="add-install">
          <h2 id="add-install" className="px-eyebrow add-step">2 · Install the agent</h2>
          <p className="add-p">Run this once on the server as a sudo user. The token works once and expires in 30 minutes.</p>

          <div className={`cmd${enabled ? "" : " cmd--off"}`} dir="ltr">
            <code className="cmd-code" aria-label="Install command">
              curl -fsSL {INSTALL_URL} | sudo sh -s -- --token {token ? (revealed ? token : mask(token)) : "pmt_sample_…"}
            </code>
            <div className="cmd-actions">
              <button type="button" className="cmd-reveal" onClick={() => setRevealed((r) => !r)} disabled={!token} aria-pressed={revealed}>
                {revealed ? "Hide" : "Reveal"}
              </button>
              <button type="button" className="px-btn px-btn--secondary px-btn--sm" onClick={copy} disabled={!enabled}>
                {copied ? <Check size={16} strokeWidth={2} aria-hidden /> : <Copy size={16} strokeWidth={1.75} aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <span className="sr-only" aria-live="polite">{copied ? "Install command copied" : ""}</span>

          <div className="cmd-meta">
            {expired ? (
              <span className="cmd-expired">
                <StatusIcon status="warning" size={13} /> Token expired.{" "}
                <button type="button" className="link-btn" onClick={newToken}>New token</button>
              </span>
            ) : (
              <span>Token expires in <strong dir="ltr" className="ink">{mmss(left)}</strong></span>
            )}
            <span>Ubuntu 20.04+ · Debian 11+ · Docker optional</span>
          </div>

          <p className="sample-note">
            <span className="sample-tag">Sample</span>
            No backend yet: this token is generated in your browser and does not work on a server.
            {!ready && step !== "success" ? " Enter a server name and client to enable Copy." : null}
          </p>

          <div className="add-status">
            {step === "success" ? (
              <div className="connected" role="status">
                <div className="connected-top">
                  <StatusPill status="healthy" label="Connected" />
                  <span className="muted nowrap" style={{ fontSize: 13 }}>First heartbeat <span dir="ltr">{cairoClock(now)}</span></span>
                </div>
                <span className="connected-text">
                  <span dir="ltr" className="cell-strong">{name}</span> is reporting. Found 6 containers, 1 Supabase, 2 domains. First daily report: tomorrow 09:00.
                </span>
                <div className="connected-actions">
                  {hostnames.includes(name) ? (
                    <Link href={`/servers/${name}`} className="px-btn px-btn--primary">Open server <ArrowRight size={18} strokeWidth={1.75} aria-hidden className="px-flip-rtl" /></Link>
                  ) : (
                    <Link href="/" className="px-btn px-btn--primary">Open Fleet <ArrowRight size={18} strokeWidth={1.75} aria-hidden className="px-flip-rtl" /></Link>
                  )}
                  <Link href="/add" className="px-btn px-btn--ghost">Add another</Link>
                </div>
              </div>
            ) : (
              <div className="waiting" role="status" aria-live="polite">
                <span className="waiting-spin" aria-hidden><Loader size={20} strokeWidth={1.75} /></span>
                <div className="waiting-text">
                  <span className="cell-strong">Waiting for first heartbeat…</span>
                  <span className="muted" style={{ fontSize: 13 }}>This page updates on its own when the agent connects.</span>
                </div>
              </div>
            )}
          </div>
          {step !== "success" ? (
            <Link href="/add?step=success" className="preview-link">Preview the connected state</Link>
          ) : null}
        </section>
      </div>
    </div>
  );
}
