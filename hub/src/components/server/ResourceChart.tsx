import { cairoTime } from "@/lib/format";

/**
 * 24h line + area chart as inline SVG (no chart library).
 * The SVG stretches to its box; strokes use non-scaling-stroke so they stay crisp.
 * Labels are HTML so they never distort, and the chart is always LTR (time runs left to right).
 */
export function ResourceChart({
  title,
  values,
  endIso,
  threshold,
  summary,
  current,
}: {
  title: string;
  /** 24 hourly values, oldest first, 0-100. `null` breaks the line. */
  values: (number | null)[];
  endIso: string;
  /** Warning line, e.g. 90 for CPU / RAM, 80 for disk. */
  threshold: number;
  summary: string;
  current: string;
}) {
  const W = 240;
  const H = 100;
  const n = values.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / 100) * H;

  // Split into runs of consecutive numbers so gaps (offline hours) stay visible.
  const runs: { i: number; v: number }[][] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ i, v });
    else runs.push([{ i, v }]);
  });
  const line = runs.map((r) => r.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(2)} ${y(p.v).toFixed(2)}`).join(" ")).join(" ");
  const area = runs
    .filter((r) => r.length > 1)
    .map((r) => `M${x(r[0].i).toFixed(2)} ${H} ${r.map((p) => `L${x(p.i).toFixed(2)} ${y(p.v).toFixed(2)}`).join(" ")} L${x(r[r.length - 1].i).toFixed(2)} ${H} Z`)
    .join(" ");

  const nums = values.filter((v): v is number => v != null);
  const peak = nums.length ? Math.max(...nums) : null;
  const peakIdx = peak == null ? -1 : values.indexOf(peak);
  const over = peak != null && peak >= threshold;
  const color = over ? "var(--color-warning)" : "var(--color-primary)";
  const endMs = Date.parse(endIso);
  const at = (hoursBack: number) => cairoTime(new Date(endMs - hoursBack * 3600000).toISOString());

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <span dir="ltr" className="chart-now">{current}</span>
      </figcaption>
      <span dir="ltr" className="chart-sub">{summary}</span>
      <div dir="ltr" className="chart-plot">
        <div className="chart-y" aria-hidden>
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <div className="chart-area" style={{ color }}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title}, last 24 hours. ${summary}. Now ${current}.`}>
            {[25, 50, 75].map((g) => (
              <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="var(--color-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} stroke="var(--color-warning)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity={0.7} />
            {area ? <path d={area} fill="currentColor" fillOpacity={0.12} /> : null}
            <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {peak != null && peakIdx >= 0 ? (
            <span className="chart-dot" style={{ insetInlineStart: `${(x(peakIdx) / W) * 100}%`, insetBlockStart: `${(y(peak) / H) * 100}%` }} aria-hidden />
          ) : null}
          <span className="chart-limit" style={{ insetBlockStart: `${(y(threshold) / H) * 100}%` }} aria-hidden>{threshold}%</span>
        </div>
        <div className="chart-x" aria-hidden>
          <span>{at(23)}</span>
          <span>{at(12)}</span>
          <span>Now</span>
        </div>
      </div>
    </figure>
  );
}
