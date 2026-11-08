import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ServerDetailView } from "@/components/server/ServerDetailView";
import { getServer } from "@/lib/data";

type Props = { params: Promise<{ hostname: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { hostname } = await params;
  return { title: hostname };
}

export default async function ServerPage({ params }: Props) {
  const { hostname } = await params;
  const detail = await getServer(hostname);
  if (!detail) notFound();
  return <ServerDetailView d={detail} now={new Date().toISOString()} />;
}
