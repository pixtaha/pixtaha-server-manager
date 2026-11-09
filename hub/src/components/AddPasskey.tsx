"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";
import { liveAuth } from "@/lib/auth/live-adapter";

type State = "idle" | "busy" | "done" | "cancelled" | "unavailable" | "signed-out" | "error";

const MESSAGE: Partial<Record<State, string>> = {
  done: "Passkey saved on this device for this site.",
  cancelled: "Cancelled. Try again when ready.",
  unavailable: "This device cannot create a passkey.",
  "signed-out": "Sign in again, then add the passkey.",
  error: "Could not add the passkey. Try again.",
};

/**
 * Adds a passkey (Touch ID, Face ID, Windows Hello) to the signed-in account. Passkeys belong to
 * one site name, so a new domain needs its own. Only shown when real sign-in is on.
 */
export function AddPasskey() {
  const [state, setState] = useState<State>("idle");

  async function add() {
    setState("busy");
    const r = await liveAuth.registerPasskey({ authenticator: "platform" });
    if (r.ok) return setState("done");
    const code = r.error.code;
    setState(code === "passkey_cancelled" ? "cancelled" : code === "passkey_unavailable" ? "unavailable" : code === "invalid_credentials" ? "signed-out" : "error");
  }

  const message = MESSAGE[state];
  return (
    <>
      <button
        type="button"
        className="px-btn px-btn--ghost px-btn--sm"
        style={{ alignSelf: "flex-start" }}
        onClick={add}
        disabled={state === "busy" || state === "done"}
        aria-busy={state === "busy"}
      >
        <KeyRound size={14} strokeWidth={1.75} aria-hidden /> {state === "busy" ? "Waiting for passkey…" : state === "done" ? "Passkey added" : "Add passkey"}
      </button>
      {message ? (
        <span role="status" className="subtle" style={{ fontSize: 12 }}>
          {message}
        </span>
      ) : null}
    </>
  );
}
