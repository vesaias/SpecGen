import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { AppShell } from "../components/ui/AppShell.js";

const TABS = [
  { to: "general", label: "General" },
  { to: "source", label: "Source" },
  { to: "ai", label: "AI" },
  { to: "connectors", label: "Connectors" },
  { to: "capture", label: "Capture" },
  { to: "danger", label: "Danger zone" },
] as const;

export function ProjectSettings() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <AppShell
      maxWidth="screen-xl"
      left={
        <>
          <Link
            to={`/projects/${slug}`}
            className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
          >
            ← {slug}
          </Link>
          <span className="text-stone-300 dark:text-stone-700">/</span>
          <span className="text-stone-700 dark:text-stone-300">Settings</span>
        </>
      }
    >
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Settings</h1>
        <div className="text-sm text-stone-500 dark:text-stone-400">{slug}</div>
      </header>

      <div className="grid grid-cols-[200px_1fr] gap-8">
        <nav className="space-y-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `block px-3 py-1.5 text-sm rounded transition-colors ${
                  isActive
                    ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                    : tab.to === "danger"
                      ? "text-red-600 dark:text-red-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                      : "text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </AppShell>
  );
}
