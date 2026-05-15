import type { Project } from "@specgen/server";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { runsApi } from "../../api/runsApi.js";
import { aiConfigured } from "../../utils/aiConfigured.js";
import { Button } from "../ui/Button.js";
import { ProgressDrawer } from "./ProgressDrawer.js";

interface Props {
  slug: string;
  className?: string;
  label?: string;
  variant?: "primary" | "secondary" | "brand";
  size?: "sm" | "md";
  /**
   * When set, the run only enriches these items (full-tree-spec respects
   * options.itemIds). Used by the per-item "Enrich" button on spec pages.
   */
  itemIds?: string[];
  /**
   * When set, the button chains an `enrichment-pipeline` run in the given
   * mode after the primary parse run completes successfully. Used for the
   * "Run parse" entry point so re-parses transparently re-enrich any items
   * whose source hash drifted. Defaults to no chaining.
   *
   * Note: the server already auto-enqueues a pipeline run in `initial` mode
   * after the *very first* successful parse (see autoEnrichOnInitialParse).
   * The chain here covers all SUBSEQUENT parses, where the server stays
   * silent. The initial overlap is harmless — `change-detect` is a no-op
   * when no item hashes drifted.
   */
  chainEnrichmentMode?: "change-detect" | "initial";
  /**
   * Optional project record so the button can show an inline "configure AI
   * first" hint instead of letting the click fall through to the server's
   * 400. Both call sites today (Dashboard card + ProjectShell topbar)
   * already have the project loaded so they pass it down for free.
   * When omitted, the click is allowed and the server-side gate is the
   * single source of truth.
   */
  project?: Pick<Project, "ai">;
}

export function RunButton({
  slug,
  className,
  label = "Update",
  variant = "primary",
  size = "md",
  itemIds,
  chainEnrichmentMode,
  project,
}: Props) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // We need a stable handle on the current run id from inside the SSE
  // callback in order to distinguish "the parse just finished" (chain a
  // change-detect) from "a chained run finished" (don't chain again).
  const chainedFromRef = useRef<string | null>(null);

  const aiOk = project ? aiConfigured(project) : true;

  useEffect(() => {
    if (!activeRunId || !chainEnrichmentMode) return;
    // Skip subscribing for runs we already chained from — the drawer's own
    // subscription will follow the chained run's events.
    if (chainedFromRef.current === activeRunId) return;
    const parseRunId = activeRunId;
    const cleanup = runsApi.subscribe(parseRunId, (event) => {
      if (event.type !== "done") return;
      if (chainedFromRef.current === parseRunId) return;
      chainedFromRef.current = parseRunId;
      // Fire-and-forget; if the chain enqueue fails we don't want to block
      // the user — they can always click "Enrich" again.
      void runsApi
        .enqueue(slug, {
          generator: "enrichment-pipeline",
          options: { mode: chainEnrichmentMode },
        })
        .then(({ runId: chainedId }) => {
          setActiveRunId(chainedId);
        })
        .catch((err: unknown) => {
          // Surface the chain failure but don't replace the original error
          // (the parse itself succeeded, after all).
          setError(`enrichment chain failed: ${(err as Error).message}`);
        });
    });
    return cleanup;
  }, [activeRunId, chainEnrichmentMode, slug]);

  async function handleRun(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Client-side gate: short-circuit the enqueue when we already know
    // there's no usable provider. Server still enforces this, but skipping
    // the round trip gives users a clearer error sooner.
    if (project && !aiConfigured(project)) {
      setError("Configure an AI provider in Settings → AI first");
      return;
    }
    setBusy(true);
    setError(null);
    chainedFromRef.current = null;
    try {
      const body = itemIds?.length ? { options: { itemIds } } : {};
      const { runId } = await runsApi.enqueue(slug, body);
      setActiveRunId(runId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={handleRun}
        disabled={busy || !aiOk}
        className={className}
        data-print-hide
        title={aiOk ? undefined : "AI provider not configured"}
      >
        {busy ? "Starting…" : label}
      </Button>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400 ml-2">
          {error}
          {project && !aiConfigured(project) && (
            <>
              {" "}
              <Link
                to={`/projects/${slug}/settings/ai`}
                className="underline"
                onClick={(e) => e.stopPropagation()}
              >
                Open settings
              </Link>
            </>
          )}
        </span>
      )}
      <ProgressDrawer runId={activeRunId} onClose={() => setActiveRunId(null)} />
    </>
  );
}
