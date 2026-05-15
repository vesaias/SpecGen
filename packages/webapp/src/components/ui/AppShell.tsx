import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { UserMenu } from "./UserMenu.js";

type MaxWidth = "screen-xl" | "screen-2xl" | "full";

interface AppShellProps {
  /** Slot for left side of topbar (back link, breadcrumb). */
  left?: ReactNode;
  /** Slot for right side of topbar (actions). ThemeToggle is appended automatically. */
  right?: ReactNode;
  /** Restrict content width. Default "screen-xl" (~1280px). */
  maxWidth?: MaxWidth;
  /** Suppress the centered content container — used by the spec view which manages its own layout. */
  fullBleed?: boolean;
  children: ReactNode;
}

const MAX_WIDTH_CLASS: Record<MaxWidth, string> = {
  "screen-xl": "max-w-screen-xl",
  "screen-2xl": "max-w-screen-2xl",
  full: "max-w-full",
};

/**
 * AppShell — a consistent topbar + content container.
 *
 * Renders a fixed-height topbar (logo on the left, slots, theme toggle) and a
 * centered content area below. Use `fullBleed` for routes that manage their
 * own layout (e.g. the spec view with its sidebar).
 */
export function AppShell({
  left,
  right,
  maxWidth = "screen-xl",
  fullBleed = false,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col">
      <header
        data-print-hide
        className="sticky top-0 z-30 h-14 px-4 sm:px-6 flex items-center gap-3 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800"
      >
        <Link
          to="/"
          className="flex items-center gap-2 text-base font-bold tracking-tight text-brand-600 dark:text-brand-300 hover:opacity-80 transition-opacity"
        >
          SpecGen
        </Link>
        {left && (
          <div className="flex items-center gap-2 min-w-0 flex-1 text-sm">
            <span className="text-stone-300 dark:text-stone-700">/</span>
            <div className="flex items-center gap-2 min-w-0">{left}</div>
          </div>
        )}
        <div className={`flex items-center gap-2 ${left ? "" : "ml-auto"}`}>
          {right}
          {right && (
            <div
              aria-hidden="true"
              className="self-stretch w-px bg-stone-200 dark:bg-stone-800 mx-1"
            />
          )}
          <UserMenu />
        </div>
      </header>

      <main className="flex-1">
        {fullBleed ? (
          children
        ) : (
          <div className={`mx-auto ${MAX_WIDTH_CLASS[maxWidth]} px-4 sm:px-6 py-8`}>{children}</div>
        )}
      </main>
    </div>
  );
}
