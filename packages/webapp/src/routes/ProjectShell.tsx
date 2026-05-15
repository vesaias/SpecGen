import type { Project } from "@specgen/server";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { projectsApi } from "../api/client.js";
import CommandPalette from "../components/CommandPalette.js";
import Sidebar from "../components/Sidebar.js";
import SpecPage from "../components/SpecPage.js";
import { AiMissingBadge } from "../components/ai/AiMissingBadge.js";
import { CaptureButton } from "../components/runs/CaptureButton.js";
import { ReParseButton } from "../components/runs/ReParseButton.js";
import { RebuildButton } from "../components/runs/RebuildButton.js";
import { RunButton } from "../components/runs/RunButton.js";
import { AppShell } from "../components/ui/AppShell.js";
import { useSearch } from "../hooks/useSearch.js";
import { useSpec } from "../hooks/useSpec.js";
import type { SpecItem, SpecJson, TreeNode } from "../types.js";
import { aiConfigured } from "../utils/aiConfigured.js";

/** Hash-based item navigation within the project shell */
function useHashId() {
  const [id, setId] = useState(() => window.location.hash.slice(1) || null);

  useEffect(() => {
    const handler = () => setId(window.location.hash.slice(1) || null);
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const navigate = useCallback((newId: string | null) => {
    if (newId) {
      window.location.hash = newId;
    } else {
      history.pushState(null, "", window.location.pathname);
    }
    setId(newId);
  }, []);

  return [id, navigate] as const;
}

export function ProjectShell() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [activeId, setActiveId] = useHashId();

  // Load project metadata
  useEffect(() => {
    if (!slug) return;
    projectsApi
      .get(slug)
      .then(setProject)
      .catch((err) => setProjectError((err as Error).message));
  }, [slug]);

  // Load spec scoped to this project
  const {
    spec,
    loading: specLoading,
    error: specError,
    updateItem,
    updateTree,
  } = useSpec({
    projectSlug: slug,
  });

  const searchResults = useSearch(spec);

  if (projectError)
    return (
      <AppShell maxWidth="screen-xl">
        <div className="text-red-600 dark:text-red-400">Error: {projectError}</div>
      </AppShell>
    );
  if (!project)
    return (
      <AppShell maxWidth="screen-xl">
        <div className="text-stone-500 dark:text-stone-400">Loading…</div>
      </AppShell>
    );

  // spec.items is Record<string, SpecItem>; runtime items include extra fields from the API
  const activeItem: SpecItem | null =
    activeId && spec?.items ? (spec.items[activeId] ?? null) : null;

  return (
    <AppShell
      fullBleed
      left={
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300 truncate">
            {project.name}
          </span>
          <span className="text-xs text-stone-400 dark:text-stone-600 truncate">
            {project.source.type}
          </span>
          {!aiConfigured(project) && slug && (
            <AiMissingBadge slug={slug} className="ml-1 self-center" />
          )}
        </div>
      }
      right={
        <>
          {/* Action group: do-something buttons */}
          <div className="flex items-center gap-2">
            {slug && (
              <RunButton slug={slug} chainEnrichmentMode="change-detect" project={project} />
            )}
            {slug && <RebuildButton slug={slug} project={project} />}
            {slug && <ReParseButton slug={slug} project={project} />}
            {slug && spec && (
              <CaptureButton
                slug={slug}
                frontendCount={
                  Object.values(spec.items).filter(
                    (i) => (i as { type?: string }).type === "frontend",
                  ).length
                }
              />
            )}
          </div>

          {/* Separator between do-something and go-somewhere */}
          <div
            aria-hidden="true"
            className="self-stretch w-px bg-stone-200 dark:bg-stone-800 mx-1"
          />

          {/* Nav group: go-somewhere links */}
          <div className="flex items-center gap-1">
            {slug && (
              <Link
                to={`/projects/${slug}/runs`}
                className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 rounded px-2 py-1 transition-colors"
              >
                Run history
              </Link>
            )}
            <Link
              to={`/projects/${slug}/settings`}
              className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 rounded px-2 py-1 transition-colors"
            >
              Settings
            </Link>
          </div>
        </>
      }
    >
      {spec && <CommandPalette results={searchResults} onSelect={setActiveId} />}

      {/* Layout: sidebar + main content */}
      <div className="flex">
        {/* Sidebar */}
        {spec && slug && (
          <Sidebar
            spec={spec as SpecJson}
            activeId={activeId}
            onSelect={setActiveId}
            onUpdateTree={(tree: TreeNode[]) => updateTree(tree)}
            projectSlug={slug}
          />
        )}

        {/* Main content area — offset by sidebar width when sidebar is shown */}
        <main className={`flex-1 ${spec ? "ml-[280px]" : ""}`}>
          {/* Spec content */}
          {specLoading && (
            <div className="p-8 text-stone-500 dark:text-stone-400 text-sm">Loading spec…</div>
          )}

          {specError && !specLoading && (
            <div className="p-8">
              <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 rounded p-4 max-w-xl">
                <div className="text-sm font-medium text-amber-900 dark:text-amber-200 mb-1">
                  No spec data found
                </div>
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  Click <strong>Update</strong> in the topbar to parse this project and generate
                  spec content.
                </div>
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-2 font-mono">
                  {project.source.type === "local" ? project.source.localPath : project.slug}
                </div>
              </div>
            </div>
          )}

          {!specLoading &&
            !specError &&
            spec &&
            (activeItem && activeId ? (
              <SpecPage
                key={activeId}
                itemId={activeId}
                item={activeItem}
                editable={editMode}
                onToggleEdit={() => setEditMode(!editMode)}
                version={spec.meta.version}
                onUpdate={(updates) => updateItem(activeId, updates)}
                projectSlug={slug}
              />
            ) : (
              <div className="text-stone-400 dark:text-stone-600 mt-20 text-center">
                <div className="text-2xl font-bold text-brand-600 dark:text-brand-300 mb-2">
                  {project.name}
                </div>
                <div className="text-sm">Select an item from the sidebar</div>
                <div className="mt-2 text-xs">
                  Press{" "}
                  <kbd className="px-1.5 py-0.5 bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded text-[10px] font-mono">
                    Ctrl+K
                  </kbd>{" "}
                  to search
                </div>
              </div>
            ))}
        </main>
      </div>
    </AppShell>
  );
}
