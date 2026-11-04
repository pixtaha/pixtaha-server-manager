"use client";

import { createContext, useContext, type ReactNode } from "react";
import { liveAuth } from "./live-adapter";
import { sampleAuth } from "./sample-adapter";
import type { AuthAdapter } from "./types";

const Ctx = createContext<AuthAdapter>(sampleAuth);

/** `live` is decided on the server: true when sign-in is configured (HUB_SECRET + Supabase). */
export function AuthProvider({ live = false, children }: { live?: boolean; children: ReactNode }) {
  return <Ctx.Provider value={live ? liveAuth : sampleAuth}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
