import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/Button.js";
import { Modal } from "../ui/Modal.js";
import { ProgressDrawer } from "./ProgressDrawer.js";

interface Props {
  slug: string;
  /** Total number of frontend items the spec will capture. Used to decide whether to confirm. */
  frontendCount: number;
  className?: string;
  size?: "sm" | "md";
}

const CONFIRM_THRESHOLD = 20;

/**
 * Triggers a frontend-capture run.
 *
 * The capture API enqueues a `frontend-capture` generator run; we follow it
 * via the standard ProgressDrawer (same SSE plumbing as the other run-y
 * buttons in the shell).
 *
 * Behaviour:
 *  - If `frontendCount > 20`, opens a confirmation modal first (capture is
 *    expensive — Chromium boot + N pages).
 *  - On HTTP 400 (likely "capture connector not configured"), surfaces a
 *    link to the Capture settings tab.
 */
export function CaptureButton({ slug, frontendCount, className, size = "md" }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfig, setNeedsConfig] = useState(false);

  async function trigger() {
    setBusy(true);
    setError(null);
    setNeedsConfig(false);
    try {
      const res = await fetch(`/api/v0/projects/${slug}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.status === 400) {
        const text = await res.text();
        setNeedsConfig(true);
        setError(text);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { runId: string };
      setConfirmOpen(false);
      setActiveRunId(body.runId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setNeedsConfig(false);
    if (frontendCount > CONFIRM_THRESHOLD) {
      setConfirmOpen(true);
    } else {
      void trigger();
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        onClick={handleClick}
        disabled={busy}
        className={className}
        data-print-hide
        title="Capture screenshots of frontend pages"
      >
        {busy ? "Starting…" : "Capture"}
      </Button>
      {error && !needsConfig && (
        <span className="text-xs text-red-600 dark:text-red-400 ml-2">{error}</span>
      )}
      {needsConfig && (
        <span className="text-xs text-amber-600 dark:text-amber-400 ml-2">
          Configure capture first —{" "}
          <Link
            to={`/projects/${slug}/settings/capture`}
            className="underline hover:text-stone-900 dark:hover:text-stone-100"
          >
            Capture settings
          </Link>
        </span>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
        title="Capture frontend screenshots"
      >
        <p className="text-sm text-stone-700 dark:text-stone-300">
          This will open <strong>{frontendCount}</strong> pages in headless Chromium and screenshot
          each one. The run is capped by the <code>maxItems</code> value in your Capture settings
          (default 50). Continue?
        </p>
        {error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" onClick={() => void trigger()} disabled={busy}>
            {busy ? "Starting…" : "Capture"}
          </Button>
        </div>
      </Modal>

      <ProgressDrawer runId={activeRunId} onClose={() => setActiveRunId(null)} />
    </>
  );
}
