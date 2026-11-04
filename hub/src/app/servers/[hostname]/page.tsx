import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/StatusPill";
import { getFleet } from "@/lib/data";

export default async function ServerPage({ params }: { params: Promise<{ hostname: string }> }) {
  const { hostname } = await params;
  const fleet = await getFleet();
  const s = fleet.servers.find((x) => x.hostname === hostname);
  if (!s) notFound();
  return (
    <div className="stack">
      <div className="muted" style={{ display: "flex", gap: 8, fontSize: 13 }}>
        <Link href="/" className="muted" style={{ textDecoration: "none" }}>Fleet</Link><span>/</span><span dir="ltr" style={{ color: "var(--color-text)" }}>{s.hostname}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1 dir="ltr" className="page-title" style={{ fontSize: 40, letterSpacing: "-0.03em" }}>{s.hostname}</h1>
        <StatusPill status={s.status} />
      </div>
      <div className="muted" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span>{s.client}</span><span className="env">{s.env}</span>
      </div>
      <div className="soon">Server detail is the next screen: 24h charts, containers, services, domains and TLS, security, backups and the changes timeline.</div>
    </div>
  );
}
