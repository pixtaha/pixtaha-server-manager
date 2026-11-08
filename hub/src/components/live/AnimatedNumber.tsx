"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 700;
/** Close to the design token --ease-out (cubic-bezier(.2,.7,.2,1)): fast start, soft landing. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A number that glides to its new value instead of jumping (live updates every 5 seconds).
 * The first render shows the final value (same HTML on server and client); only later changes animate.
 * Respects prefers-reduced-motion.
 */
export function AnimatedNumber({ value, format = (v) => String(Math.round(v)) }: { value: number | null | undefined; format?: (v: number) => string }) {
  const [shown, setShown] = useState<number | null>(value ?? null);
  const from = useRef<number | null>(value ?? null);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (value == null) {
      setShown(null);
      from.current = null;
      return;
    }
    const start = from.current;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (start == null || start === value || reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION_MS);
      const v = start + (value - start) * easeOut(t);
      setShown(v);
      from.current = v;
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value]);

  return <span className="num">{shown == null ? "—" : format(shown)}</span>;
}
