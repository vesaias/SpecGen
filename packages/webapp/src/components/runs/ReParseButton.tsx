import type { Project } from "@specgen/server";
import { useState } from "react";
import { runsApi } from "../../api/runsApi.js";
import { Button } from "../ui/Button.js";
import { ProgressDrawer } from "./ProgressDrawer.js";

interface Props {
  slug: string;
  /** Optional project record — not used for an AI gate (parse runs no AI),
   * accepted for symmetry with RunButton / RebuildButton. */
  project?: Pick<Project, "ai">;
}

/**
 * "Re-parse" — parse-only counterpart to Update. Fires full-tree-spec
 * directly with NO enrichment chain, so no AI tokens get burned. Useful
 * when iterating on parser changes (e.g. testing whether a parser now
 * detects a frontend subdir) without committing to a 30+ item enrichment
 * run.
 *
 * The server's auto-enrich-on-initial-parse listener only fires on the
 * very first successful full-tree-spec run per project; subsequent
 * re-parses don't re-trigger it. So this button is genuinely "no AI" on
 * any project that already has at least one prior successful parse.
 */
export function ReParseButton({ slug }: Props) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const { runId } = await runsApi.enqueue(slug, {
        generator: "full-tree-spec",
      });
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
        type="button"
        variant="secondary"
        onClick={handleClick}
        disabled={busy}
        title="Re-run parsers only — no AI enrichment, no token cost. Useful for testing parser fixes."
        data-print-hide
      >
        {busy ? "Re-parsing…" : "Re-parse (no AI)"}
      </Button>
      {error && <span className="text-xs text-red-600 dark:text-red-400 ml-2">{error}</span>}
      <ProgressDrawer runId={activeRunId} onClose={() => setActiveRunId(null)} />
    </>
  );
}
