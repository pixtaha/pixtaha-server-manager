import { FleetView } from "@/components/FleetView";
import { getFleet } from "@/lib/data";

export default async function FleetPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const [fleet, sp] = await Promise.all([getFleet(), searchParams]);
  // ?state=empty and ?state=loading preview the empty and loading states from the design.
  const state = sp.state === "empty" || sp.state === "loading" ? sp.state : "populated";
  return <FleetView fleet={state === "empty" ? { ...fleet, servers: [] } : fleet} loading={state === "loading"} />;
}
