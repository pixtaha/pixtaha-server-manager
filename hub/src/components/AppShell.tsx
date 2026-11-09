"use client";

import { Bell, LayoutGrid, LogOut, Mail, Menu, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AddPasskey } from "./AddPasskey";
import { AlertsStateProvider, useAlertsState } from "./alerts/AlertsState";
import { InstallApp } from "./InstallApp";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

const NAV = [
  { href: "/", label: "Fleet", icon: LayoutGrid, match: (p: string) => p === "/" || p.startsWith("/servers/") },
  { href: "/alerts", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/alerts") },
  { href: "/add", label: "Add server", icon: Plus, match: (p: string) => p.startsWith("/add") },
  { href: "/reports", label: "Daily reports", icon: Mail, match: (p: string) => p.startsWith("/reports") },
];

/** Matches the 900px breakpoint in app.css where the sidebar is replaced by the app bar. */
const MOBILE_QUERY = "(max-width: 900px)";

/** Signed-in account, or null when sign-in is not configured (local preview with sample data). */
const AccountCtx = createContext<{ email: string } | null>(null);

export function AppShell({ children, openAlertIds, account = null }: { children: ReactNode; openAlertIds: string[]; account?: { email: string } | null }) {
  return (
    <AccountCtx.Provider value={account}>
      <AlertsStateProvider openIds={openAlertIds}>
        <Shell>{children}</Shell>
      </AlertsStateProvider>
    </AccountCtx.Provider>
  );
}

function NavList({ pathname, label, onNavigate }: { pathname: string; label: string; onNavigate?: () => void }) {
  const { openCount } = useAlertsState();
  return (
    <nav className="nav" aria-label={label}>
      {NAV.map(({ href, label: text, icon: Icon, match }) => (
        <Link key={href} href={href} className="nav-item" aria-current={match(pathname) ? "page" : undefined} onClick={onNavigate}>
          <Icon size={18} strokeWidth={1.75} aria-hidden />
          <span className="nav-label">{text}</span>
          {href === "/alerts" && openCount > 0 ? (
            <span className="nav-count" aria-label={`${openCount} open alerts`}>
              {openCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

function Account() {
  const account = useContext(AccountCtx);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }
  return (
    <div className="account">
      <span dir="ltr" style={{ fontSize: 13 }}>{account?.email ?? "contact@pixtaha.com"}</span>
      <span className="subtle" style={{ fontSize: 12 }}>Read-only · Cairo UTC+2</span>
      {account ? (
        <>
          <button type="button" className="px-btn px-btn--ghost px-btn--sm" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={signOut} disabled={busy} aria-busy={busy}>
            <LogOut size={14} strokeWidth={1.75} aria-hidden /> {busy ? "Signing out…" : "Sign out"}
          </button>
          <AddPasskey />
        </>
      ) : null}
      <InstallApp />
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setMenuOpen(false), []);

  // Close on route change (covers back/forward too, not only link clicks).
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Wordmark />
        <NavList pathname={pathname} label="Main" />
        <div className="side-card">
          <div className="side-row">
            <span className="muted" style={{ fontSize: 13 }}>Theme</span>
            <ThemeToggle />
          </div>
          <Account />
        </div>
      </aside>

      <header className="appbar">
        <Wordmark size={17} />
        <button
          ref={menuBtn}
          type="button"
          className="icon-btn icon-btn--lg"
          aria-label="Menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? "mobile-menu" : undefined}
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={20} strokeWidth={1.75} aria-hidden />
        </button>
      </header>

      {menuOpen ? <MenuSheet pathname={pathname} onClose={close} returnFocus={menuBtn} /> : null}

      <main className="main">{children}</main>
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Mobile navigation sheet: modal dialog with focus trap, Escape / backdrop / route change to close. */
function MenuSheet({ pathname, onClose, returnFocus }: { pathname: string; onClose: () => void; returnFocus: React.RefObject<HTMLButtonElement | null> }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = panel.current;
    const btn = returnFocus.current;
    // Focus the current page link, else the first focusable element.
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    // Lock page scroll behind the sheet.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // The sheet only exists below 900px: close it if the window grows past that.
    const mq = window.matchMedia(MOBILE_QUERY);
    const onMq = () => {
      if (!mq.matches) onClose();
    };
    mq.addEventListener("change", onMq);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      mq.removeEventListener("change", onMq);
      btn?.focus();
    };
  }, [onClose, returnFocus]);

  return (
    <div className="sheet-root">
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div ref={panel} id="mobile-menu" className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <span id={titleId} className="sheet-title">Menu</span>
          <button type="button" className="icon-btn icon-btn--lg" aria-label="Close menu" onClick={onClose}>
            <X size={20} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <NavList pathname={pathname} label="Main" onNavigate={onClose} />
        <div className="side-card sheet-foot">
          <div className="side-row">
            <span className="muted" style={{ fontSize: 13 }}>Theme</span>
            <ThemeToggle />
          </div>
          <Account />
        </div>
      </div>
    </div>
  );
}
