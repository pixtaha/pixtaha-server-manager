"use client";

import { createContext, useContext, type ReactNode } from "react";
import { sampleAuth } from "./sample-adapter";
import type { AuthAdapter } from "./types";

const Ctx = createContext<AuthAdapter>(sampleAuth);

/** Wrap the sign-in pages. Pass the real adapter here once Supabase Auth and WebAuthn are wired. */
export function AuthProvider({ adapter = sampleAuth, children }: { adapter?: AuthAdapter; children: ReactNode }) {
  return <Ctx.Provider value={adapter}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
