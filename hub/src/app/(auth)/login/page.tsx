import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authConfigured, getSession } from "@/lib/auth/server";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginFlow, type LoginPreview } from "@/components/auth/LoginFlow";

export const metadata: Metadata = { title: "Sign in" };

const PREVIEWS: LoginPreview[] = ["wrong-code", "rate-limited", "no-passkey"];

/** Review states: ?state=wrong-code | rate-limited | no-passkey */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const live = authConfigured();
  if (live) {
    const s = await getSession();
    if (s?.mfa_done) redirect("/");
  }
  // Review states are for the sample UI only.
  const preview = live ? null : (PREVIEWS.find((p) => p === state) ?? null);
  // Computed on the server so the server HTML and the client agree on "Unlocks at hh:mm".
  const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  return (
    <AuthShell>
      <LoginFlow key={preview ?? "default"} preview={preview} previewRetryAt={retryAt} />
    </AuthShell>
  );
}
