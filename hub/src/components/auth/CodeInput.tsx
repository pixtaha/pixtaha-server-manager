"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

/**
 * Six single-digit boxes for TOTP codes.
 * - Typing advances to the next box, Backspace on an empty box goes back, arrow keys move.
 * - Pasting (or SMS / password-manager autofill into any box) spreads the digits across the boxes.
 * - The value is a 6-char array; empty boxes are "".
 */
export function CodeInput({
  value,
  onChange,
  invalid = false,
  disabled = false,
  label = "6-digit code",
  autoFocus = false,
  size = "lg",
  describedBy,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
  disabled?: boolean;
  label?: string;
  autoFocus?: boolean;
  size?: "md" | "lg";
  describedBy?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(5, i))];
    el?.focus();
    el?.select();
  };

  const fill = (from: number, digits: string) => {
    const next = [...value];
    digits
      .slice(0, 6 - from)
      .split("")
      .forEach((c, k) => (next[from + k] = c));
    onChange(next);
    focus(Math.min(5, from + digits.length));
  };

  const onInput = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length > 1) return fill(digits.length >= 6 ? 0 : i, digits);
    const next = [...value];
    next[i] = digits;
    onChange(next);
    if (digits) focus(i + 1);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      e.preventDefault();
      const next = [...value];
      next[i - 1] = "";
      onChange(next);
      focus(i - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "");
    if (!digits) return;
    e.preventDefault();
    fill(digits.length >= 6 ? 0 : i, digits);
  };

  return (
    <div role="group" aria-label={label} dir="ltr" className={`code code--${size}`}>
      {value.map((v, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="code-box"
          value={v}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={6}
          aria-label={`Digit ${i + 1} of 6`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={(e) => onPaste(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

export const emptyCode = () => ["", "", "", "", "", ""];
export const codeFromString = (s: string) => s.padEnd(6, " ").slice(0, 6).split("").map((c) => c.trim());
