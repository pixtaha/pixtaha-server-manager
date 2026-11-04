import { AlertsView } from "@/components/alerts/AlertsView";
import { getAlerts } from "@/lib/data";

export const metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const data = await getAlerts();
  return <AlertsView data={data} />;
}
