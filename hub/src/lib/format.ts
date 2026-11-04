const TZ = "Africa/Cairo";

/** "Wed 4 Nov · 09:14 Cairo" */
export function cairoStamp(iso: string): string {
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} · ${parts.hour}:${parts.minute} Cairo`;
}

/** "14s ago", "7m ago", "3h ago", "2d ago" relative to a reference time. */
export function ago(iso: string, refIso: string): string {
  const s = Math.max(0, Math.round((Date.parse(refIso) - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
