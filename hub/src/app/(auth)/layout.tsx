import type { ReactNode } from "react";
import { authConfigured } from "@/lib/auth/server";
import { AuthProvider } from "@/lib/auth/context";
import "@/styles/auth.css";

/** Sign-in pages: own centered layout, no sidebar or menu. Real sign-in when it is configured. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthProvider live={authConfigured()}>{children}</AuthProvider>;
}
