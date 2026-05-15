import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../../hooks/useTheme.js";

/**
 * Small overflow menu in the topbar holding global / cross-project actions
 * (Profiles, theme toggle, future Account / Sign out). Keeps the topbar tidy
 * vs hanging every global action directly as siblings of per-project actions.
 */
export function UserMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open user menu"
        aria-expanded={open}
        className="w-8 h-8 rounded-full border border-stone-300 dark:border-stone-700 hover:border-stone-500 dark:hover:border-stone-500 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-950"
      >
        {/* Three vertical dots */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-48 rounded border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-lg py-1 z-40 text-sm"
        >
          <Link
            to="/profiles"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            Profiles
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              toggle();
              setOpen(false);
            }}
            className="block w-full text-left px-3 py-1.5 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      )}
    </div>
  );
}
