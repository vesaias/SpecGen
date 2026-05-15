import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { projectsApi } from "../../api/client.js";
import { profilesApi } from "../../api/profilesApi.js";
import { Button } from "../ui/Button.js";

interface Props {
  profileId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Project picker for the global "Fork into project" action.
 *
 * Fork data lives per-project, so forking a packaged profile from the
 * global /profiles view needs a target project. This modal lists the
 * user's projects, performs the fork via `profilesApi.fork(slug, ...)`,
 * then navigates to the project-scoped profile detail page where the
 * user can edit the forked copy.
 */
export function ForkIntoProjectModal({ profileId, open, onClose }: Props) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forkingSlug, setForkingSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    projectsApi
      .list()
      .then(setProjects)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  async function handleFork(slug: string) {
    setForkingSlug(slug);
    setError(null);
    try {
      await profilesApi.fork(slug, profileId);
      onClose();
      navigate(`/projects/${slug}/profiles/${profileId}`);
    } catch (err) {
      const msg = (err as Error).message;
      // 409 = already forked; navigate to that project's profile so the user
      // can edit the existing fork rather than seeing a "duplicate" error.
      if (msg.includes("409")) {
        onClose();
        navigate(`/projects/${slug}/profiles/${profileId}`);
        return;
      }
      setError(msg);
    } finally {
      setForkingSlug(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded shadow-lg w-[480px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <header className="px-4 py-3 border-b border-stone-200 dark:border-stone-800">
          <h2 className="text-sm font-medium text-stone-900 dark:text-stone-100">
            Fork into project
          </h2>
          <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            Forks live per-project. Pick the project to fork{" "}
            <code className="font-mono">{profileId}</code> into.
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-2">
          {loading && (
            <div className="text-sm text-stone-500 dark:text-stone-400 p-2">Loading projects…</div>
          )}
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 p-2">Error: {error}</div>
          )}
          {!loading && projects.length === 0 && (
            <div className="text-sm text-stone-500 dark:text-stone-400 p-2">
              No projects yet. Create one first.
            </div>
          )}
          <ul className="space-y-0.5">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => handleFork(p.slug)}
                  disabled={forkingSlug !== null}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <div className="text-sm text-stone-900 dark:text-stone-100">{p.name}</div>
                  <div className="text-xs font-mono text-stone-500 dark:text-stone-400">
                    {p.slug}
                    {forkingSlug === p.slug && " · forking…"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <footer className="px-4 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </footer>
      </div>
    </div>
  );
}
