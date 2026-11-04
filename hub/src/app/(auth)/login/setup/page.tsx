import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { SetupFlow, type SetupStep } from "@/components/auth/SetupFlow";

export const metadata: Metadata = { title: "Set up access" };

/** Account shown during setup. Sample until the invite link carries the real account. */
const SAMPLE_ACCOUNT = "contact@pixtaha.com";

/** Review a step directly: ?step=1 | 2 | 3 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { step } = await searchParams;
  const initial: SetupStep = step === "2" ? 2 : step === "3" ? 3 : 1;
  return (
    <AuthShell setup>
      <SetupFlow key={initial} account={SAMPLE_ACCOUNT} initialStep={initial} />
    </AuthShell>
  );
}
