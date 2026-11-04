import { cairoTime } from "@/lib/format";

/**
 * 24h line + area chart as inline SVG (no chart library), following the Claude Design detail frame:
 * title + meta on top, 120px plot with 25/50/75 gridlines, glow fill, primary line, 5 time labels below.
 * Always LTR: time runs left to right in every locale.
 */
export function ResourceChart({ title, meta, values, endIso }: { title: string; meta: string; values: (number | null)[]; endIso: string }) {
  const W = 300;
  const H = 100;
  const n = values.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - Math.max(0, Math.min(100, v));

  // Consecutive runs, so hours without data (offline) stay a visible gap.
  const runs: { i: number; v: number }[][] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ i, v });
    else runs.push([{ i, v }]);
  });
  const f = (v: number) => v.toFixed(1);
  const line = runs.map((r) => r.map((p, k) => `${k ? "L" : "M"}${f(x(p.i))} ${f(y(p.v))}`).join(" ")).join(" ");
  const area = runs
    .filter((r) => r.length > 1)
    .map((r) => `${r.map((p, k) => `${k ? "L" : "M"}${f(x(p.i))} ${f(y(p.v))}`).join(" ")} L${f(x(r[r.length - 1].i))} ${H} L${f(x(r[0].i))} ${H} Z`)
    .join(" ");

  // Five labels, every 6 hours, rounded to the hour like the design ("09:00 15:00 21:00 03:00 09:00").
  const end = Math.round(Date.parse(endIso) / 3600000) * 3600000;
  const ticks = [24, 18, 12, 6, 0].map((h) => cairoTime(new Date(end - h * 3600000).toISOString()));

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <span dir="ltr" className="chart-meta">{meta}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart-svg" role="img" aria-label={`${title}, last 24 hours: ${meta}`}>
        <path d="M0 25H300M0 50H300M0 75H300" stroke="var(--color-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {area ? <path d={area} fill="var(--color-glow)" /> : null}
        <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div dir="ltr" className="chart-x" aria-hidden>
        {ticks.map((t, i) => <span key={i}>{t}</span>)}
      </div>
    </figure>
  );
}
