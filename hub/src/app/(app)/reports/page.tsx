import Link from "next/link";
import { StatusPill } from "@/components/StatusPill";
import { getReports } from "@/lib/data";
import { cairoTime } from "@/lib/format";
import type { ReportListItem } from "@/lib/types";

export const metadata = { title: "Daily reports" };

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(iso));

/** Every report the collectors sent, newest first, grouped by Cairo day. ?server=<hostname> filters. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ server?: string }> }) {
  const [{ sample, items }, { server }] = await Promise.all([getReports(), searchParams]);
  const list = server ? items.filter((r) => r.hostname === server) : items;
  const days = new Map<string, ReportListItem[]>();
  for (const r of list) {
    const k = dayKey(r.generated_at);
    days.set(k, [...(days.get(k) ?? []), r]);
  }
  const hosts = [...new Set(items.map((r) => r.hostname))].sort();

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Daily reports</h1>
          <p className="page-sub">Every report the collectors sent, as it was when it arrived. The 09:00 email is built from the same report.</p>
        </div>
      </div>

      {hosts.length > 1 ? (
        <nav className="chip-row" aria-label="Filter by server">
          <Link href="/reports" className="chip" aria-current={!server ? "page" : undefined}>All servers <span className="chip-n">{items.length}</span></Link>
          {hosts.map((h) => (
            <Link key={h} href={`/reports?server=${encodeURIComponent(h)}`} className="chip" aria-current={server === h ? "page" : undefined} dir="ltr">
              {h} <span className="chip-n">{items.filter((r) => r.hostname === h).length}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {list.length === 0 ? (
        <div className="soon">{server ? `No reports from ${server} yet.` : "No reports yet. Each server sends one at 08:55 Cairo time."}</div>
      ) : (
        [...days.entries()].map(([k, rows]) => (
          <section key={k} className="panel panel--flush" aria-label={DAY.format(new Date(rows[0].generated_at))}>
            <div className="panel-head">
              <h2 className="panel-title">{DAY.format(new Date(rows[0].generated_at))}</h2>
              <span className="panel-meta">{rows.length} report{rows.length > 1 ? "s" : ""}</span>
            </div>
            <div className="dtable-wrap">
              <table className="dtable" aria-label="Reports">
                <thead>
                  <tr>
                    <th scope="col">Server</th>
                    <th scope="col">Status</th>
                    <th scope="col">Issues</th>
                    <th scope="col">Time</th>
                    <th scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="dt-primary" data-label="Server">
                        <Link href={`/reports/${encodeURIComponent(r.id)}`} className="cell-strong" dir="ltr">{r.hostname}</Link>
                        <div className="subtle" style={{ fontSize: 12 }}>
                          {r.client} <span className="env">{r.env}</span>
                          {/-test\d*$|-manual/.test(r.id) ? <span className="env" style={{ marginInlineStart: 6 }}>test</span> : null}
                        </div>
                      </td>
                      <td data-label="Status"><StatusPill status={r.status} size="sm" /></td>
                      <td data-label="Issues">
                        {r.critical || r.warning ? (
                          <span dir="ltr">
                            {r.critical ? <span style={{ color: "var(--color-critical)" }}>{r.critical} critical</span> : null}
                            {r.critical && r.warning ? " · " : null}
                            {r.warning ? <span style={{ color: "var(--color-warning)" }}>{r.warning} warning{r.warning > 1 ? "s" : ""}</span> : null}
                          </span>
                        ) : (
                          <span className="subtle">None</span>
                        )}
                      </td>
                      <td data-label="Time" dir="ltr" className="mono">{cairoTime(r.generated_at)}</td>
                      <td data-label="">
                        <Link href={`/reports/${encodeURIComponent(r.id)}`} className="px-btn px-btn--ghost px-btn--sm">Open</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
      {sample ? <span className="foot-note">Sample data · fictional reports. Real reports appear here once the collectors send them.</span> : null}
    </div>
  );
}
