import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { themeInitScript } from "@/components/ThemeToggle";
import "@fontsource/ibm-plex-sans/latin-300.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@/styles/tokens.css";
import "@/styles/app.css";

export const metadata: Metadata = {
  title: { default: "Server Manager · Pixtaha Management", template: "%s · Pixtaha Management" },
  description: "Fleet health for every server, container and service.",
  robots: { index: false, follow: false },
  applicationName: "Pixtaha Management",
  appleWebApp: { capable: true, title: "Pixtaha", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // "cover" lets the standalone iOS app draw under the status bar; env(safe-area-inset-*) padding keeps content clear of it.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#14110E" },
    { media: "(prefers-color-scheme: light)", color: "#FAF6F1" },
  ],
};

/** Root: document, fonts, tokens and theme only. The app shell lives in (app)/layout.tsx, the sign-in shell in (auth). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
