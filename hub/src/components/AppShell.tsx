"use client";

import { Bell, LayoutGrid, Mail, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

const NAV = [
  { href: "/", label: "Fleet", icon: LayoutGrid, match: (p: string) => p === "/" || p.startsWith("/servers/") },
  { href: "/alerts", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/alerts") },
  { href: "/add", label: "Add server", icon: Plus, match: (p: string) => p.startsWith("/add") },
  { href: "/reports", label: "Daily reports", icon: Mail, match: (p: string) => p.startsWith("/reports") },
];

export function AppShell({ children, openAlerts }: { children: ReactNode; openAlerts: number }) {
  const pathname = usePathname() ?? "/";
  return (
    <div className="shell">
      <aside className="sidebar">
        <Wordmark />
        <nav className="nav" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon, match }) => (
            <Link key={href} href={href} className="nav-item" aria-current={match(pathname) ? "page" : undefined}>
              <Icon size={18} strokeWidth={1.75} aria-hidden />
              <span className="nav-label">{label}</span>
              {href === "/alerts" && openAlerts > 0 ? <span className="nav-count">{openAlerts}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="side-card">
          <div className="side-row">
            <span className="muted" style={{ fontSize: 13 }}>Theme</span>
            <ThemeToggle />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span dir="ltr" style={{ fontSize: 13 }}>contact@pixtaha.com</span>
            <span className="subtle" style={{ fontSize: 12 }}>Read-only · Cairo UTC+2</span>
          </div>
        </div>
      </aside>

      <header className="appbar">
        <Wordmark size={17} />
        <ThemeToggle large />
      </header>

      <main className="main">{children}</main>
    </div>
  );
}
