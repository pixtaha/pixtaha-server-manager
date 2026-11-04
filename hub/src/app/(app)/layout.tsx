import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { getAlerts } from "@/lib/data";

/** Dashboard pages: sidebar on desktop, app bar + menu sheet on mobile. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { alerts } = await getAlerts();
  const openAlertIds = alerts.filter((a) => a.state === "open").map((a) => a.id);
  return <AppShell openAlertIds={openAlertIds}>{children}</AppShell>;
}
