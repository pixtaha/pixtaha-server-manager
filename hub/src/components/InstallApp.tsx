"use client";

import { Download, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/** Chrome / Edge / Android event; not in the TS DOM lib. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Mode = "hidden" | "prompt" | "ios";

// One listener for the whole app: the event fires once per page load, often before the menu sheet mounts.
let deferred: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    subscribers.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    subscribers.forEach((fn) => fn());
  });
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIosSafari() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function currentMode(): Mode {
  if (isStandalone()) return "hidden";
  if (deferred) return "prompt";
  if (isIosSafari()) return "ios";
  return "hidden";
}

/** "Install app" entry for the sidebar Account area and the mobile menu sheet. Hidden when installed or not installable. */
export function InstallApp() {
  const [mode, setMode] = useState<Mode>("hidden");
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const update = () => setMode(currentMode());
    update();
    subscribers.add(update);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener("change", update);
    return () => {
      subscribers.delete(update);
      mq.removeEventListener("change", update);
    };
  }, []);

  if (mode === "hidden") return null;

  async function onClick() {
    if (mode === "ios") {
      setHelp(true);
      return;
    }
    const ev = deferred;
    if (!ev) return;
    deferred = null; // prompt() can only be called once per event.
    await ev.prompt().catch(() => null);
    await ev.userChoice.catch(() => null);
    setMode(currentMode());
  }

  return (
    <>
      <button type="button" className="px-btn px-btn--ghost px-btn--sm install-btn" onClick={onClick} aria-haspopup={mode === "ios" ? "dialog" : undefined}>
        <Download size={14} strokeWidth={1.75} aria-hidden /> Install app
      </button>
      {help ? <IosHelp onClose={() => setHelp(false)} /> : null}
    </>
  );
}

/** iOS Safari has no install prompt API: explain Share > Add to Home Screen. */
function IosHelp({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        // Single focusable control: keep focus on it; Escape closes.
        e.preventDefault();
        if (e.key === "Escape") onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div className="install-root">
      <div className="install-backdrop" onClick={onClose} aria-hidden />
      <div className="install-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="install-head">
          <span id={titleId} className="install-title">Install Pixtaha</span>
          <button ref={closeBtn} type="button" className="icon-btn icon-btn--lg" aria-label="Close" onClick={onClose}>
            <X size={20} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <p className="install-lead">Tap Share, then Add to Home Screen.</p>
        <ol className="install-steps">
          <li>
            <span className="install-step-icon"><Share size={18} strokeWidth={1.75} aria-hidden /></span>
            <span>Tap <strong>Share</strong> in the Safari toolbar.</span>
          </li>
          <li>
            <span className="install-step-icon"><SquarePlus size={18} strokeWidth={1.75} aria-hidden /></span>
            <span>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</span>
          </li>
        </ol>
        <p className="install-note">The app opens full screen. Sign in once inside the app: it keeps its own session, separate from Safari.</p>
      </div>
    </div>
  );
}
