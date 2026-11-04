"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const KEY = "pm-theme";

/** Dark is the default. The choice is a per-browser convenience, so storage errors are ignored. */
export function ThemeToggle({ large = false }: { large?: boolean }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "light" || current === "dark") setTheme(current);
  }, []);

  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: keep the in-memory choice */
    }
  };

  return (
    <button type="button" onClick={flip} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} className={large ? "icon-btn icon-btn--lg" : "icon-btn"}>
      {theme === "dark" ? <Sun size={large ? 20 : 16} strokeWidth={1.75} /> : <Moon size={large ? 20 : 16} strokeWidth={1.75} />}
    </button>
  );
}

/** Inline script for <head>: applies the saved theme before paint to avoid a flash. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
