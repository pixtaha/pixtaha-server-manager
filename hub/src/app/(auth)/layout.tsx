import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/context";
import "@/styles/auth.css";

/**
 * Sign-in pages: own centered layout, no sidebar or menu.
 * No middleware guards the dashboard yet; this is UI only with the sample adapter.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
