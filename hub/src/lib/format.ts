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

/** "09:14" in Cairo time. */
export function cairoTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** "4 Nov" in Cairo time. */
export function cairoDay(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric", month: "short" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month}`;
}

/** "Today 09:14", "Yesterday 22:10", "2 Nov 03:30" relative to a reference time (Cairo). */
export function cairoWhen(iso: string, refIso: string): string {
  const day = (x: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(x));
  const d = day(iso);
  if (d === day(refIso)) return `Today ${cairoTime(iso)}`;
  if (d === day(new Date(Date.parse(refIso) - 86400000).toISOString())) return `Yesterday ${cairoTime(iso)}`;
  return `${cairoDay(iso)} ${cairoTime(iso)}`;
}

/** "41d 7h" or "5h 12m". */
export function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** 412 -> "412 MB", 2340 -> "2.3 GB". */
export function mb(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1024) return `${(v / 1024).toFixed(1)} GB`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} MB`;
}

/** 1284 -> "1,284". */
export const num = (v: number) => v.toLocaleString("en-US");

/** "520 ms", "1.4 s". */
export const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

/** "48 s", "5m 12s", "47m 20s". */
export function dur(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
