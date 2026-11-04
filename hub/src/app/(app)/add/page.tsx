import { AddServerView } from "@/components/add/AddServerView";
import { getFleet } from "@/lib/data";

export const metadata = { title: "Add server" };

/** `?step=success` previews the connected state until the backend can report a real first heartbeat. */
export default async function AddServerPage({ searchParams }: { searchParams: Promise<{ step?: string; name?: string }> }) {
  const [fleet, sp] = await Promise.all([getFleet(), searchParams]);
  const clients = Array.from(new Set(fleet.servers.map((s) => s.client))).sort();
  const hostnames = fleet.servers.map((s) => s.hostname);
  return <AddServerView key={sp.step ?? "waiting"} clients={clients} hostnames={hostnames} step={sp.step === "success" ? "success" : "waiting"} previewName={sp.name} now={fleet.generatedAt} />;
}
