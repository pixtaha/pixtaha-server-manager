"use client";

import { useEffect, useRef, useState } from "react";

export const LIVE_EVERY_MS = 5000;
/** A live snapshot older than this is not shown as live (matches LIVE_FRESH_MS on the server). */
export const LIVE_FRESH_MS = 2 * 60 * 1000;

/**
 * Polls a JSON endpoint every 5 seconds while the tab is visible (and once right away when it becomes
 * visible again). Returns the newest `data` field, the client clock of the last poll and whether the last
 * poll failed. Stops on unmount.
 */
export function useLivePoll<T>(url: string | null, initial: T, initialNow: number, everyMs = LIVE_EVERY_MS) {
  const [data, setData] = useState<T>(initial);
  // starts at the server render time so the first client render matches the HTML (no hydration mismatch)
  const [now, setNow] = useState<number>(initialNow);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!url) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctl = new AbortController();

    const tick = async () => {
      if (stop) return;
      if (!document.hidden && !busy.current) {
        busy.current = true;
        try {
          const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
          if (res.status === 401) {
            window.location.assign("/login");
            return;
          }
          const body = (await res.json()) as { data?: T | null };
          if (!res.ok || body.data == null) throw new Error(String(res.status));
          setData(body.data);
          setFailed(false);
        } catch {
          if (!stop) setFailed(true);
        } finally {
          busy.current = false;
          if (!stop) setNow(Date.now());
        }
      }
      if (!stop) timer = setTimeout(tick, everyMs);
    };
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        tick();
      }
    };

    timer = setTimeout(tick, everyMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearTimeout(timer);
      ctl.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, everyMs]);

  return { data, now, failed };
}

export function isFresh(liveAt: string | null | undefined, now: number): boolean {
  return Boolean(liveAt && now - Date.parse(liveAt) <= LIVE_FRESH_MS);
}
