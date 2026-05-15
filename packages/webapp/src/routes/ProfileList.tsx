import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { projectsApi } from "../api/client.js";
import { type ProfileSummary, profilesApi } from "../api/profilesApi.js";
import { AppShell } from "../components/ui/AppShell.js";

/**
 * Profile listing. Behaves in two modes:
 *
 *  - Project-scoped (`/projects/:slug/profiles`): URL has a `slug`. Renders
 *    breadcrumb pointing back at the project, marks the project's active
 *    profile, and links the per-card "Open →" to the project-scoped detail
 *    route. Forks visible in this view include both packaged profiles and
 *    any project-scoped forks (returned by `/api/profiles`).
 *
 *  - Global (`/profiles`): No `slug`. Renders only packaged profiles (forks
 *    are per-project data and are not surfaced here). Per-card "Open →"
 *    links to the slugless detail route, which surfaces a project picker
 *    when the user wants to fork.
 *
 * The two modes share rendering so the only differences are the breadcrumb
 * slot, the "Active" badge, and the link targets.
 */
export function ProfileList() {
  const { slug } = useParams<{ slug?: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const profilesPromise = profilesApi.list();
    if (slug) {
      Promise.all([projectsApi.get(slug), profilesPromise])
        .then(([p, list]) => {
          setProject(p);
          setProfiles(list);
        })
        .catch((err) => setError((err as Error).message))
        .finally(() => setLoaded(true));
    } else {
      profilesPromise
        .then((list) => {
          setProject(null);
          // Global view: only show packaged profiles. Forks are per-project
          // data and live under the project's profiles list, not here.
          setProfiles(list.filter((p) => p.source === "packaged"));
        })
        .catch((err) => setError((err as Error).message))
        .finally(() => setLoaded(true));
    }
  }, [slug]);

  if (error)
    return (
      <AppShell maxWidth="screen-xl">
        <div className="text-red-600 dark:text-red-400">Error: {error}</div>
      </AppShell>
    );
  if (!loaded)
    return (
      <AppShell maxWidth="screen-xl">
        <div className="text-stone-500 dark:text-stone-400">Loading…</div>
      </AppShell>
    );

  const activeId = slug
    ? ((project?.ai as { profileId?: string } | undefined)?.profileId ?? "pm-spec")
    : null;

  const breadcrumb = slug ? (
    <>
      <Link
        to={`/projects/${slug}`}
        className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
      >
        ← {slug}
      </Link>
      <span className="text-stone-300 dark:text-stone-700">/</span>
      <span className="text-stone-700 dark:text-stone-300">Profiles</span>
    </>
  ) : (
    <span className="text-stone-700 dark:text-stone-300">Profiles</span>
  );

  return (
    <AppShell maxWidth="screen-2xl" left={breadcrumb}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Profiles</h1>
        <div className="text-sm text-stone-500 dark:text-stone-400">
          {slug && project ? (
            <>
              {project.name} · active:{" "}
              <code className="font-mono bg-stone-100 dark:bg-stone-800 px-1 rounded">
                {activeId}
              </code>
            </>
          ) : (
            <>Packaged profiles available to any project. Forks live per-project.</>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {profiles.map((p) => (
          <div
            key={p.id}
            className="border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded p-4 hover:border-stone-400 dark:hover:border-stone-600 transition-colors"
          >
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="font-medium text-stone-900 dark:text-stone-100">{p.name}</h3>
              {slug && p.id === activeId && (
                <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 rounded">
                  Active
                </span>
              )}
            </div>
            <div className="text-sm text-stone-500 dark:text-stone-400 mb-3">
              {p.description ?? "—"}
            </div>
            <div className="text-xs text-stone-400 dark:text-stone-600 mb-4">
              <code className="font-mono">{p.id}</code> · {p.source}
            </div>
            <Link
              to={slug ? `/projects/${slug}/profiles/${p.id}` : `/profiles/${p.id}`}
              className="text-sm text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 underline"
            >
              Open →
            </Link>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
