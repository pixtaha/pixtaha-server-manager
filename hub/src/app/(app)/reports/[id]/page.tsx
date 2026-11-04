import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ServerDetailView } from "@/components/server/ServerDetailView";
import { getReport } from "@/lib/data";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: decodeURIComponent(id) };
}

/** One stored report, shown with the Server detail layout as it was when it arrived. */
export default async function ReportPage({ params }: Props) {
  const { id } = await params;
  const r = await getReport(decodeURIComponent(id));
  if (!r) notFound();
  return <ServerDetailView d={r.detail} now={r.item.generated_at} asReport={{ id: r.item.id }} />;
}
