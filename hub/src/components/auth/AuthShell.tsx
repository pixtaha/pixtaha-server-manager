import type { ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";

/** Centered sign-in layout from docs/design/auth-screen.dc.html: glow, wordmark header, card, footer. No sidebar, no menu. */
export function AuthShell({ setup = false, children }: { setup?: boolean; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-glow" aria-hidden>
        <div />
      </div>
      <header className="auth-top">
        <Wordmark size={17} />
        {setup ? <span className="auth-top-note">First-time setup</span> : null}
      </header>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
      <footer className="auth-foot">
        <span>Pixtaha Management · read-only fleet monitoring</span>
        <span>Times in Cairo (UTC+2)</span>
      </footer>
    </div>
  );
}

export function AuthHeading({ title, text, id }: { title: string; text?: ReactNode; id?: string }) {
  return (
    <div className="auth-heading">
      <h1 id={id} className="auth-title">{title}</h1>
      {text ? <p className="auth-text">{text}</p> : null}
    </div>
  );
}

/** Inline alert box (warning or danger) with icon + bold title + body. */
export function AuthNotice({ tone, icon, title, children }: { tone: "warning" | "danger"; icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div role="alert" className={`auth-notice auth-notice--${tone}`}>
      <span className="auth-notice-icon">{icon}</span>
      <div className="auth-notice-body">
        <strong>{title}</strong>
        {children ? <span className="muted">{children}</span> : null}
      </div>
    </div>
  );
}

/** Marks sample-only values while the auth backend is not connected. */
export function SampleTag({ children = "Sample" }: { children?: ReactNode }) {
  return <span className="sample-tag">{children}</span>;
}
