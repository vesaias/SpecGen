import { useCallback, useEffect, useState } from "react";
import { usePrintMode } from "../hooks/usePrintMode.js";
import type { BackendItem, Block, EventItem, FrontendItem, SpecItem } from "../types";
import BackendPage from "./BackendPage";
import EventPage from "./EventPage";
import { ExportMenu } from "./ExportMenu.js";
import FrontendPage from "./FrontendPage";
import VersionDiff from "./VersionDiff";
import VersionHistory from "./VersionHistory";
import { ReEnrichButton } from "./runs/ReEnrichButton.js";
import { Button } from "./ui/Button.js";

interface Props {
  itemId: string;
  item: SpecItem;
  editable: boolean;
  onToggleEdit: () => void;
  version: string;
  onUpdate: (updates: Partial<SpecItem>) => void;
  /** When provided, version history/diff fetch from project-scoped API */
  projectSlug?: string;
}

/** Runtime fields injected by the server / CLI that are not in the SpecItem schema */
type RuntimeItem = SpecItem & {
  _version?: number;
  _lastModified?: string;
  _modifiedBy?: string;
  blocks?: Block[];
};

export default function SpecPage({
  itemId,
  item,
  editable,
  onToggleEdit,
  version,
  onUpdate,
  projectSlug,
}: Props) {
  const rt = item as RuntimeItem;
  const itemVersion = rt._version ?? 1;
  const lastModified = rt._lastModified;

  const [showHistory, setShowHistory] = useState(false);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);

  // Print-mode handshake: when `?print=1` is in the URL, signal to the
  // Puppeteer-driven PdfService (server-side) that the page is fully laid out
  // and fonts have loaded. PdfService waits on this flag before calling
  // `page.pdf()`.
  const isPrint = usePrintMode();
  useEffect(() => {
    if (!isPrint) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      (window as unknown as { __SPECGEN_PRINT_READY__?: boolean }).__SPECGEN_PRINT_READY__ = true;
    });
    return () => {
      cancelled = true;
    };
  }, [isPrint]);

  const handleRestore = useCallback(
    async (v: number) => {
      try {
        const url = projectSlug
          ? `/api/projects/${encodeURIComponent(projectSlug)}/spec/item/${encodeURIComponent(itemId)}/restore/${v}`
          : `/api/spec/item/${encodeURIComponent(itemId)}/restore/${v}`;
        const res = await fetch(url, { method: "POST" });
        if (res.ok) window.location.reload();
      } catch (err) {
        console.error("Restore failed:", err);
      }
    },
    [itemId, projectSlug],
  );

  // Format relative time
  function relativeTime(iso: string): string {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  const editToggle = (
    <div className="flex items-center gap-2" data-print-hide>
      {projectSlug && (
        <ReEnrichButton
          slug={projectSlug}
          itemId={itemId}
          label="Re-enrich"
          variant="secondary"
          size="sm"
        />
      )}
      {projectSlug && <ExportMenu slug={projectSlug} itemId={itemId} />}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowHistory(true)}
        title="Version history"
      >
        v{itemVersion} · {relativeTime(lastModified ?? "")}
      </Button>
      <Button variant="brand" size="sm" pressed={editable} onClick={onToggleEdit}>
        {editable ? "Editing" : "View"}
      </Button>
    </div>
  );

  function renderPage() {
    switch (item.type) {
      case "backend":
        return (
          <BackendPage
            item={item as BackendItem}
            editable={editable}
            version={version}
            editToggle={editToggle}
            onUpdate={(updates) => onUpdate(updates as Partial<SpecItem>)}
          />
        );
      case "frontend":
        return (
          <FrontendPage
            item={item as FrontendItem}
            editable={editable}
            version={version}
            editToggle={editToggle}
            onUpdate={(updates) => onUpdate(updates as Partial<SpecItem>)}
            projectSlug={projectSlug}
          />
        );
      case "event":
      case "handler":
        return (
          <EventPage
            item={item as EventItem}
            editable={editable}
            version={version}
            editToggle={editToggle}
            onUpdate={(updates) => onUpdate(updates as Partial<SpecItem>)}
          />
        );
      default:
        return <div className="text-stone-400 dark:text-stone-500">Unknown item type</div>;
    }
  }

  return (
    <>
      {compareVersion !== null && (
        <VersionDiff
          itemId={itemId}
          currentBlocks={rt.blocks ?? []}
          compareVersion={compareVersion}
          onClose={() => setCompareVersion(null)}
          projectSlug={projectSlug}
        />
      )}

      {renderPage()}

      {showHistory && (
        <VersionHistory
          itemId={itemId}
          currentVersion={itemVersion}
          onClose={() => setShowHistory(false)}
          onRestore={handleRestore}
          onCompare={(v) => {
            setCompareVersion(v);
            setShowHistory(false);
          }}
          projectSlug={projectSlug}
        />
      )}
    </>
  );
}
