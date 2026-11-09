import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { requireViewer } from "@/lib/auth/server";
import { getAlerts } from "@/lib/data";

/**
 * Dashboard pages: sidebar on desktop, app bar + menu sheet on mobile.
 * With sign-in configured, every page needs a full session (password + authenticator, or passkey).
 * The data functions in lib/data.ts check the session again: this layout does not run on every
 * client navigation, so it cannot be the only gate.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const s = await requireViewer();
  const account = s ? { email: s.email } : null;
  const { alerts } = await getAlerts();
  const openAlertIds = alerts.filter((a) => a.state === "open").map((a) => a.id);
  return (
    <AppShell openAlertIds={openAlertIds} account={account}>
      {children}
    </AppShell>
  );
}
