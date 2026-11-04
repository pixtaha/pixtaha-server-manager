import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { authConfigured, getSession } from "@/lib/auth/server";
import { getAlerts } from "@/lib/data";

/**
 * Dashboard pages: sidebar on desktop, app bar + menu sheet on mobile.
 * With sign-in configured, every page needs a full session (password + authenticator, or passkey).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  let account: { email: string } | null = null;
  if (authConfigured()) {
    const s = await getSession();
    if (!s) redirect("/login");
    if (!s.mfa_done) redirect("/login/setup");
    account = { email: s.email };
  }
  const { alerts } = await getAlerts();
  const openAlertIds = alerts.filter((a) => a.state === "open").map((a) => a.id);
  return (
    <AppShell openAlertIds={openAlertIds} account={account}>
      {children}
    </AppShell>
  );
}
