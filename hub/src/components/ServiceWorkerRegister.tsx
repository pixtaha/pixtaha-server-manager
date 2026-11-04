"use client";

import { useEffect } from "react";

/** Registers /sw.js in production only (dev keeps HMR free of a service worker). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => null);
  }, []);
  return null;
}
