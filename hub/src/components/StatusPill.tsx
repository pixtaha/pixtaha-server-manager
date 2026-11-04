import { STATUS_LABEL, type Severity, type Status } from "@/lib/types";

/** Status always shows icon + text label, never colour alone. Icons follow the Claude Design Status Pill. */
export function StatusIcon({ status, size }: { status: Status; size: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (status) {
    case "critical":
      return <svg {...common}><path d="M12 2.5 21.5 12 12 21.5 2.5 12z" /><path d="M12 8v4.5" /><path d="M12 16h.01" /></svg>;
    case "warning":
      return <svg {...common}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>;
    case "offline":
      return <svg {...common}><circle cx="12" cy="12" r="9.5" /><path d="m5.3 5.3 13.4 13.4" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="9.5" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>;
  }
}

/** `variant="plain"` drops the background (Claude Design Status Pill "plain"). `label` overrides the text (e.g. a container state), the icon still follows the status. */
export function StatusPill({ status, size = "md", label, variant = "pill" }: { status: Status; size?: "sm" | "md"; label?: string; variant?: "pill" | "plain" }) {
  return (
    <span role="status" className={`pill pill--${status}${size === "sm" ? " pill--sm" : ""}${variant === "plain" ? " pill--plain" : ""}`}>
      <StatusIcon status={status} size={size === "sm" ? 12 : 14} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

/** Payload v1 severities map onto the four hub statuses. `info` reads as healthy, `unknown` as offline. */
export function sevStatus(sev: Severity): Status {
  if (sev === "critical" || sev === "warning" || sev === "offline") return sev;
  return sev === "unknown" ? "offline" : "healthy";
}
