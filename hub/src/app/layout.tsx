import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
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
};

export const viewport: Viewport = {
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
      </body>
    </html>
  );
}
