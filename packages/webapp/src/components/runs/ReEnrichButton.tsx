import { useState } from "react";
import { itemsApi } from "../../api/itemsApi.js";
import { Button } from "../ui/Button.js";
import { ProgressDrawer } from "./ProgressDrawer.js";

interface Props {
  slug: string;
  itemId: string;
  className?: string;
  label?: string;
  variant?: "primary" | "secondary" | "brand";
  size?: "sm" | "md";
}

/**
 * Per-item "Re-enrich" trigger. POSTs to the v0 single-item endpoint
 * (`POST /api/v0/projects/:slug/items/:itemId/enrich`), which enqueues an
 * `enrichment-pipeline` run in `mode: "single"`. On success we open the
 * shared ProgressDrawer to tail the returned run id via SSE.
 *
 * Disabled while a request is in flight. Network / 404 / 4xx failures are
 * rendered inline next to the button so the user can react.
 */
export function ReEnrichButton({
  slug,
  itemId,
  className,
  label = "Re-enrich",
  variant = "secondary",
  size = "sm",
}: Props) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const { runId } = await itemsApi.enrich(slug, itemId);
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
        onClick={handleClick}
        disabled={busy}
        className={className}
        data-print-hide
        title="Re-run AI enrichment for this item"
      >
        {busy ? "Starting…" : label}
      </Button>
      {error && <span className="text-xs text-red-600 dark:text-red-400 ml-2">{error}</span>}
      <ProgressDrawer runId={activeRunId} onClose={() => setActiveRunId(null)} />
    </>
  );
}
