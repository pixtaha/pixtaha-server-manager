import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { SetupFlow, type SetupStep } from "@/components/auth/SetupFlow";
import { authConfigured, getSession } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Set up access" };

/** Account shown in the sample UI. */
const SAMPLE_ACCOUNT = "contact@pixtaha.com";

/**
 * First-time setup. Live: opened from the one-time invite link (?invite=...), or with a session that
 * still needs a passkey / authenticator / backup codes. Sample: ?step=0..3 opens a step for review.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string; invite?: string }> }) {
  const { step, invite } = await searchParams;
  if (!authConfigured()) {
    const initial: SetupStep = step === "0" ? 0 : step === "2" ? 2 : step === "3" ? 3 : 1;
    return (
      <AuthShell setup>
        <SetupFlow key={initial} account={SAMPLE_ACCOUNT} initialStep={initial} invite={initial === 0 ? "sample" : undefined} />
      </AuthShell>
    );
  }
  const s = await getSession();
  if (!s) {
    if (!invite) redirect("/login");
    return (
      <AuthShell setup>
        <SetupFlow account={(process.env.HUB_ADMIN_EMAIL ?? "").toLowerCase()} initialStep={0} invite={invite} />
      </AuthShell>
    );
  }
  if (s.mfa_done) redirect("/");
  const initial: SetupStep = s.passkeys === 0 && !s.totp_enabled ? 1 : !s.totp_enabled ? 2 : 3;
  return (
    <AuthShell setup>
      <SetupFlow account={s.email} initialStep={initial} />
    </AuthShell>
  );
}
