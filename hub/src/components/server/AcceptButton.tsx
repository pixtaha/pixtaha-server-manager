"use client";

import { Check, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Accept" an attention item Taha decided to keep (with an optional reason), or undo it.
 * Accepted items stay in the list, marked, but no longer set the server status.
 */
export function AcceptButton({ host, issueKey, accepted }: { host: string; issueKey: string; accepted: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const send = async (accept: boolean) => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, key: issueKey, accept, note: accept ? note : undefined }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setOpen(false);
      setNote("");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (accepted) {
    return (
      <button type="button" className="attn-act" onClick={() => send(false)} disabled={busy}>
        <Undo2 size={14} strokeWidth={1.75} aria-hidden /> {busy ? "Undoing…" : "Undo accept"}
      </button>
    );
  }
  if (!open) {
    return (
      <button type="button" className="attn-act" onClick={() => setOpen(true)}>
        <Check size={14} strokeWidth={1.75} aria-hidden /> Accept
      </button>
    );
  }
  return (
    <form
      className="attn-accept"
      onSubmit={(e) => {
        e.preventDefault();
        send(true);
      }}
    >
      <input
        className="field-input attn-accept-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why it is OK (optional)"
        maxLength={300}
        aria-label="Reason for accepting"
        autoFocus
      />
      <button type="submit" className="px-btn px-btn--primary attn-accept-btn" disabled={busy}>{busy ? "Saving…" : "Accept risk"}</button>
      <button type="button" className="px-btn px-btn--secondary attn-accept-btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      {error ? <span className="attn-accept-err" role="alert">Could not save. Try again.</span> : null}
    </form>
  );
}
