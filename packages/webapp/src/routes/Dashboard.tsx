import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { projectsApi } from "../api/client.js";
import { AiMissingBadge } from "../components/ai/AiMissingBadge.js";
import { RebuildButton } from "../components/runs/RebuildButton.js";
import { RunButton } from "../components/runs/RunButton.js";
import { AppShell } from "../components/ui/AppShell.js";
import { Button } from "../components/ui/Button.js";
import { aiConfigured } from "../utils/aiConfigured.js";

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectsApi
      .list()
      .then(setProjects)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell
      maxWidth="screen-2xl"
      right={
        <Link to="/projects/new">
          <Button variant="primary" size="md">
            + New project
          </Button>
        </Link>
      }
    >
      <header className="flex items-baseline justify-between mb-8">
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Projects</h1>
        <span className="text-sm text-stone-500 dark:text-stone-500">
          {projects.length === 0
            ? ""
            : `${projects.length} project${projects.length === 1 ? "" : "s"}`}
        </span>
      </header>

      {loading && <div className="text-stone-500 dark:text-stone-500">Loading…</div>}
      {error && <div className="text-red-600 dark:text-red-400">Error: {error}</div>}

      {!loading && !error && (
        <section>
          {projects.length === 0 ? (
            <div className="p-8 border border-dashed border-stone-300 dark:border-stone-700 rounded text-center text-stone-500 dark:text-stone-400">
              No projects yet.{" "}
              <Link to="/projects/new" className="underline text-stone-700 dark:text-stone-300">
                Create one →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="border border-stone-200 dark:border-stone-800 rounded bg-white dark:bg-stone-900 hover:border-stone-400 dark:hover:border-stone-600 transition-colors flex flex-col"
                >
                  <Link to={`/projects/${p.slug}`} className="block p-4 flex-1">
                    <div className="flex items-baseline justify-between mb-1 gap-2">
                      <h3 className="font-medium text-stone-900 dark:text-stone-100 truncate">
                        {p.name}
                      </h3>
                      <span className="text-xs text-stone-400 dark:text-stone-600 shrink-0">
                        {p.source.type}
                      </span>
                    </div>
                    {!aiConfigured(p) && (
                      <div className="mb-2">
                        <AiMissingBadge slug={p.slug} />
                      </div>
                    )}
                    <div className="text-sm text-stone-500 dark:text-stone-400">
                      {p.description ?? "—"}
                    </div>
                    <div className="text-xs text-stone-400 dark:text-stone-600 mt-2">
                      {p.lastParsedAt
                        ? `parsed ${new Date(p.lastParsedAt).toLocaleDateString()}`
                        : "never parsed"}
                    </div>
                  </Link>
                  <div className="px-4 pb-3 pt-2 border-t border-stone-100 dark:border-stone-800 flex items-center gap-2">
                    <RunButton
                      slug={p.slug}
                      size="sm"
                      chainEnrichmentMode="change-detect"
                      project={p}
                    />
                    <RebuildButton slug={p.slug} size="sm" project={p} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </AppShell>
  );
}
