"use client";

import { Check, Clock } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { cairoWhen } from "@/lib/format";
import type { AlertItem, AlertsSnapshot, AlertState, Status } from "@/lib/types";
import { useAlertsState } from "./AlertsState";

/*
 * Alerts center, ported from docs/design/dashboard-app.dc.html (pg.alerts).
 * Open duplicates of the same check on several servers collapse into one group row.
 */

const TABS: { id: AlertState; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "acknowledged", label: "Acknowledged" },
  { id: "resolved", label: "Resolved" },
];
const SEV_RANK: Record<Status, number> = { critical: 0, warning: 1, offline: 2, healthy: 3 };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

interface Row {
  key: string;
  checkId: string;
  name: string;
  detail: string;
  severity: Status;
  items: AlertItem[];
  firstSeen: string;
  occurrences: number;
}

export function AlertsView({ data }: { data: AlertsSnapshot }) {
  const { acked, muted, acknowledge, mute } = useAlertsState();
  const [tab, setTab] = useState<AlertState>("open");
  const [sel, setSel] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const ref = data.generatedAt;

  // Effective state: client-side acknowledgements move open alerts to "acknowledged".
  const stateOf = (a: AlertItem): AlertState => (a.state === "open" && acked.has(a.id) ? "acknowledged" : a.state);

  const counts = useMemo(() => {
    const c: Record<AlertState, number> = { open: 0, acknowledged: 0, resolved: 0 };
    data.alerts.forEach((a) => c[a.state === "open" && acked.has(a.id) ? "acknowledged" : a.state]++);
    return c;
  }, [data.alerts, acked]);

  const rows = useMemo<Row[]>(() => {
    const inTab = data.alerts.filter((a) => (a.state === "open" && acked.has(a.id) ? "acknowledged" : a.state) === tab);
    const byCheck = new Map<string, AlertItem[]>();
    inTab.forEach((a) => byCheck.set(a.check_id, [...(byCheck.get(a.check_id) ?? []), a]));
    return [...byCheck.entries()]
      .map(([checkId, items]) => {
        const check = data.checks[checkId];
        const sorted = [...items].sort((a, z) => z.occurrences - a.occurrences);
        const single = items.length === 1;
        return {
          key: `${tab}:${checkId}`,
          checkId,
          name: check?.name ?? checkId,
          detail: single ? items[0].detail : check?.summary ?? "",
          severity: items.reduce<Status>((w, a) => (SEV_RANK[a.severity] < SEV_RANK[w] ? a.severity : w), "healthy"),
          items: sorted,
          firstSeen: items.reduce((m, a) => (a.first_seen_at < m ? a.first_seen_at : m), items[0].first_seen_at),
          occurrences: items.reduce((n, a) => n + a.occurrences, 0),
        };
      })
      .sort((a, z) => SEV_RANK[a.severity] - SEV_RANK[z.severity] || z.occurrences - a.occurrences);
  }, [data.alerts, data.checks, acked, tab]);

  const selectable = tab === "open";
  const selectedIds = rows.filter((r) => sel.has(r.key)).flatMap((r) => r.items.map((a) => a.id));
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.key));
  const someOn = rows.some((r) => sel.has(r.key));

  const toggle = (key: string) => setSel((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleAll = () => setSel(allOn ? new Set() : new Set(rows.map((r) => r.key)));
  const toggleGroup = (key: string) => setExpanded((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const switchTab = (t: AlertState) => {
    setTab(t);
    setSel(new Set());
  };

  const stateLabel = (a: AlertItem): { text: string; color: string } => {
    const st = stateOf(a);
    if (st === "resolved") return { text: a.resolved_at ? `Resolved ${cairoWhen(a.resolved_at, ref)}` : "Resolved", color: "var(--color-text-subtle)" };
    if (st === "acknowledged") return { text: "Acknowledged", color: "var(--color-text-subtle)" };
    if (muted[a.id]) return { text: "Muted 1h", color: "var(--color-text-muted)" };
    const c = a.severity === "critical" ? "var(--color-critical)" : a.severity === "offline" ? "var(--color-offline)" : "var(--color-warning)";
    return { text: "Open", color: c };
  };
  /** A group reads "Open" while any of its alerts is open and not muted. */
  const rowState = (r: Row) => {
    const live = r.items.find((a) => stateOf(a) === "open" && !muted[a.id]);
    return stateLabel(live ?? r.items[0]);
  };

  return (
    <div className="stack alerts">
      <div className="alerts-head">
        <h1 className="page-title">Alerts</h1>
        <span className="muted">Duplicates are grouped by check. Acknowledging silences repeats for that check until it changes.</span>
      </div>

      <div className="tabs" role="tablist" aria-label="Alert state">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="tab" onClick={() => switchTab(t.id)}>
            {t.label} <span dir="ltr" className="tab-n">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {selectable && selectedIds.length ? (
        <div className="selbar" role="region" aria-label="Bulk actions">
          <span className="selbar-n">{rows.filter((r) => sel.has(r.key)).length} selected</span>
          <span className="selbar-sp" />
          <button
            type="button"
            className="px-btn px-btn--primary px-btn--sm"
            onClick={() => {
              acknowledge(selectedIds);
              setSel(new Set());
            }}
          >
            <Check size={16} strokeWidth={2} aria-hidden /> Acknowledge
          </button>
          <button
            type="button"
            className="px-btn px-btn--secondary px-btn--sm"
            onClick={() => {
              mute(selectedIds, 60);
              setSel(new Set());
            }}
          >
            <Clock size={16} strokeWidth={2} aria-hidden /> Mute 1h
          </button>
          <button type="button" className="px-btn px-btn--ghost px-btn--sm" onClick={() => setSel(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      <div className={`al-table${selectable ? "" : " al-table--nosel"}`} role="table" aria-label={`${TABS.find((t) => t.id === tab)!.label} alerts`}>
        <div className="al-row al-row--head" role="row">
          <span className="al-sel" role="columnheader">
            {selectable && rows.length ? (
              <label className="al-check">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = someOn && !allOn;
                  }}
                  onChange={toggleAll}
                />
                <span className="al-selall">Select all</span>
              </label>
            ) : null}
          </span>
          <span className="al-sev" role="columnheader">Severity</span>
          <span className="al-check-name" role="columnheader">Check</span>
          <span className="al-server" role="columnheader">Server</span>
          <span className="al-first" role="columnheader">First seen</span>
          <span className="al-occ" role="columnheader">Occurrences</span>
          <span className="al-state" role="columnheader">State</span>
        </div>

        {rows.length === 0 ? (
          <div className="al-empty">
            <StatusPill status="healthy" size="sm" variant="plain" label={tab === "open" ? "No open alerts. Every check passed." : tab === "acknowledged" ? "Nothing acknowledged." : "No resolved alerts in the last 30 days."} />
          </div>
        ) : null}

        {rows.map((r) => {
          const group = r.items.length > 1;
          const open = group && expanded.has(r.key);
          const st = rowState(r);
          const on = sel.has(r.key);
          return (
            <Fragment key={r.key}>
              <div className={`al-row${on ? " is-selected" : ""}`} role="row">
                <span className="al-sel" role="cell">
                  {selectable ? (
                    <label className="al-check">
                      <input type="checkbox" aria-label={`Select ${r.name}${group ? ` on ${r.items.length} servers` : ` on ${r.items[0].hostname}`}`} checked={on} onChange={() => toggle(r.key)} />
                    </label>
                  ) : null}
                </span>
                <span className="al-sev" role="cell">
                  <StatusPill status={r.severity} size="sm" />
                </span>
                <span className="al-check-name" role="cell">
                  <span className="al-name">{r.name}</span>
                  <span className="al-detail">{r.detail}</span>
                </span>
                <span className="al-server" role="cell">
                  {group ? (
                    <>
                      <span>{plural(r.items.length, "server")}</span>
                      <button type="button" className="al-group" aria-expanded={open} onClick={() => toggleGroup(r.key)}>
                        {open ? "Hide" : "Show"} {r.items.length} grouped
                      </button>
                    </>
                  ) : (
                    <Link dir="ltr" href={`/servers/${r.items[0].hostname}`} className="al-host">{r.items[0].hostname}</Link>
                  )}
                </span>
                <span className="al-first muted" role="cell" data-label="First seen">{cairoWhen(r.firstSeen, ref)}</span>
                <span className="al-occ mono" role="cell" data-label="Occurrences"><span dir="ltr">{r.occurrences}</span></span>
                <span className="al-state" role="cell" style={{ color: st.color }}>
                  <span className="al-dot" style={{ background: st.color }} aria-hidden />
                  {st.text}
                </span>
              </div>
              {open
                ? r.items.map((a) => {
                    const cs = stateLabel(a);
                    return (
                      <div key={a.id} className="al-row al-row--child" role="row">
                        <span className="al-sel" role="cell" />
                        <span className="al-sev" role="cell" />
                        <span className="al-check-name muted" role="cell">{a.detail}</span>
                        <span className="al-server" role="cell">
                          <Link dir="ltr" href={`/servers/${a.hostname}`} className="al-host">{a.hostname}</Link>
                        </span>
                        <span className="al-first muted" role="cell" data-label="First seen">{cairoWhen(a.first_seen_at, ref)}</span>
                        <span className="al-occ mono" role="cell" data-label="Occurrences"><span dir="ltr">{a.occurrences}</span></span>
                        <span className="al-state muted" role="cell">{cs.text}</span>
                      </div>
                    );
                  })
                : null}
            </Fragment>
          );
        })}
      </div>

      {data.sample ? <span className="foot-note">Sample data · fictional alerts. Acknowledge and mute are kept in this browser tab until the backend is connected.</span> : null}
    </div>
  );
}
