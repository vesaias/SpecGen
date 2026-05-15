import type { Project } from "@specgen/server";
import { useState } from "react";
import { Link } from "react-router-dom";
import { runsApi } from "../../api/runsApi.js";
import { aiConfigured } from "../../utils/aiConfigured.js";
import { Button } from "../ui/Button.js";
import { Modal } from "../ui/Modal.js";
import { ProgressDrawer } from "./ProgressDrawer.js";

interface Props {
  slug: string;
  className?: string;
  size?: "sm" | "md";
  /**
   * Optional project record so the button can short-circuit when AI is
   * missing. See RunButton for the same shape.
   */
  project?: Pick<Project, "ai">;
}

/**
 * "Rebuild" — the expensive counterpart to "Update".
 *
 * Enqueues a single `enrichment-pipeline` run with:
 *   { mode: "initial", force: true, forceBootstrap: true }
 *
 * `force` bypasses the drift / TODO gate inside full-tree-spec, so every
 * AI-enriched field is re-generated. `forceBootstrap` re-runs the project
 * bootstrap stage. Manual edits in fields the AI does NOT rewrite are
 * preserved via mergeSpec, but fields the AI owns will be overwritten —
 * hence the confirmation modal.
 */
export function RebuildButton({ slug, className, size = "md", project }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aiOk = project ? aiConfigured(project) : true;

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const { runId } = await runsApi.enqueue(slug, {
        generator: "enrichment-pipeline",
        options: { mode: "initial", force: true, forceBootstrap: true },
      });
      setConfirmOpen(false);
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
        variant="secondary"
        size={size}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setError(null);
          if (project && !aiConfigured(project)) {
            setError("Configure an AI provider in Settings → AI first");
            return;
          }
          setConfirmOpen(true);
        }}
        disabled={!aiOk}
        className={className}
        data-print-hide
        title={aiOk ? undefined : "AI provider not configured"}
      >
        Rebuild
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

      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
        title="Rebuild documentation"
      >
        <p className="text-sm text-stone-700 dark:text-stone-300">
          This re-generates every AI-enriched field for every item (one AI call per item, plus
          project bootstrap). Manual edits in fields the AI rewrites will be overwritten. Continue?
        </p>
        {error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={busy}>
            {busy ? "Starting…" : "Rebuild"}
          </Button>
        </div>
      </Modal>

      <ProgressDrawer runId={activeRunId} onClose={() => setActiveRunId(null)} />
    </>
  );
}
