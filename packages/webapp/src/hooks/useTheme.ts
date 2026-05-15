import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

/** Read the active theme from the DOM (set by the inline script in index.html). */
function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * Theme hook.
 *
 * Reads `localStorage.theme` ("light" | "dark") or falls back to
 * `prefers-color-scheme`. Adds/removes the `dark` class on `<html>`.
 *
 * The initial class is set synchronously by an inline script in `index.html`
 * to avoid a flash of the wrong theme on first paint.
 */
export function useTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Persist + apply whenever the theme changes.
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore (e.g. sandboxed iframe)
    }
  }, [theme]);

  // Track OS-level preference changes (only if user hasn't explicitly chosen)
  // and cross-tab updates via the storage event.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      let hasExplicit = false;
      try {
        hasExplicit = localStorage.getItem(STORAGE_KEY) !== null;
      } catch {
        // ignore
      }
      if (hasExplicit) return;
      setThemeState(e.matches ? "dark" : "light");
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = e.newValue;
      if (next !== "light" && next !== "dark") return;
      setThemeState((prev) => (prev === next ? prev : next));
    };

    mql.addEventListener("change", handleMediaChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      mql.removeEventListener("change", handleMediaChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, setTheme, toggle };
}
