"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Client-only alert actions until the backend exists.
 * Lives in the app shell, so acknowledging on /alerts updates the sidebar badge and survives navigation
 * (but not a reload: nothing is persisted yet).
 */
interface AlertsActions {
  acked: ReadonlySet<string>;
  /** Alert id -> ISO time the mute ends. */
  muted: Readonly<Record<string, string>>;
  acknowledge: (ids: string[]) => void;
  mute: (ids: string[], minutes: number) => void;
  /** Open alerts that are not acknowledged in this session. */
  openCount: number;
}

const Ctx = createContext<AlertsActions | null>(null);

export function AlertsStateProvider({ openIds, children }: { openIds: string[]; children: ReactNode }) {
  const [acked, setAcked] = useState<ReadonlySet<string>>(() => new Set());
  const [muted, setMuted] = useState<Record<string, string>>({});

  const acknowledge = useCallback((ids: string[]) => setAcked((cur) => new Set([...cur, ...ids])), []);
  const mute = useCallback((ids: string[], minutes: number) => {
    const until = new Date(Date.now() + minutes * 60000).toISOString();
    setMuted((cur) => ({ ...cur, ...Object.fromEntries(ids.map((id) => [id, until])) }));
  }, []);

  const value = useMemo(
    () => ({ acked, muted, acknowledge, mute, openCount: openIds.filter((id) => !acked.has(id)).length }),
    [acked, muted, acknowledge, mute, openIds],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAlertsState(): AlertsActions {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAlertsState must be used inside AlertsStateProvider");
  return v;
}
