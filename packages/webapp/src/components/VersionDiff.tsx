import { useEffect, useState } from "react";
import type { Block } from "../types";

interface Props {
  itemId: string;
  currentBlocks: Block[];
  compareVersion: number;
  onClose: () => void;
  /** When provided, fetches from /api/projects/:slug/spec/item/:id/version/:v */
  projectSlug?: string;
}

interface VersionData {
  version: number;
  blocks: Block[];
  at: string;
  by: string;
}

type DiffStatus = "added" | "removed" | "modified" | "unchanged";

interface DiffEntry {
  status: DiffStatus;
  block: Block;
}

function blockSummary(block: Block): string {
  switch (block.type) {
    case "richtext":
    case "callout": {
      if (!block.content) return `(empty ${block.type})`;
      // content is Tiptap JSON — try to extract text, fall back to raw truncation
      try {
        const parsed = JSON.parse(block.content);
        const text = extractText(parsed);
        if (text) return text.slice(0, 100) + (text.length > 100 ? "..." : "");
      } catch {
        /* not JSON, use raw */
      }
      const raw = block.content.replace(/<[^>]*>/g, "").trim();
      return raw.slice(0, 100) + (raw.length > 100 ? "..." : "");
    }
    case "code":
      if (!block.content) return "(empty code block)";
      return block.content.slice(0, 100) + (block.content.length > 100 ? "..." : "");
    case "table":
      if (!block.table) return "(empty table)";
      return `${block.table.columns.length} column${block.table.columns.length !== 1 ? "s" : ""}, ${block.table.rows.length} row${block.table.rows.length !== 1 ? "s" : ""}`;
    case "response":
      if (!block.responses) return "(empty response block)";
      return `${block.responses.length} response${block.responses.length !== 1 ? "s" : ""}`;
    case "image":
      return block.meta?.src ? `Image: ${block.meta.src}` : "(image)";
    default:
      return block.type;
  }
}

type TiptapNode = { text?: string; content?: TiptapNode[] };

function extractText(node: TiptapNode): string {
  if (node.text) return node.text;
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractText).join(" ");
  }
  return "";
}

function blocksMatch(a: Block, b: Block): boolean {
  // Deep-compare the content-bearing fields
  if (a.type !== b.type) return false;
  if (a.content !== b.content) return false;
  if (JSON.stringify(a.table) !== JSON.stringify(b.table)) return false;
  if (JSON.stringify(a.responses) !== JSON.stringify(b.responses)) return false;
  if (JSON.stringify(a.meta) !== JSON.stringify(b.meta)) return false;
  return true;
}

function computeDiff(currentBlocks: Block[], oldBlocks: Block[]): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const oldById = new Map(oldBlocks.map((b) => [b.id, b]));
  const currentById = new Map(currentBlocks.map((b) => [b.id, b]));

  // Walk current blocks
  for (const block of currentBlocks) {
    const old = oldById.get(block.id);
    if (!old) {
      entries.push({ status: "added", block });
    } else if (!blocksMatch(block, old)) {
      entries.push({ status: "modified", block });
    } else {
      entries.push({ status: "unchanged", block });
    }
  }

  // Blocks in old but not in current = removed
  for (const block of oldBlocks) {
    if (!currentById.has(block.id)) {
      entries.push({ status: "removed", block });
    }
  }

  return entries;
}

const borderColor: Record<DiffStatus, string> = {
  added: "border-l-green-500",
  removed: "border-l-red-500",
  modified: "border-l-amber-500",
  unchanged: "border-l-transparent",
};

const statusLabel: Record<DiffStatus, { text: string; className: string }> = {
  added: {
    text: "Added",
    className: "text-green-600 dark:text-green-300 bg-green-50 dark:bg-green-950",
  },
  removed: {
    text: "Removed",
    className: "text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950",
  },
  modified: {
    text: "Modified",
    className: "text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-950",
  },
  unchanged: {
    text: "Unchanged",
    className: "text-stone-400 dark:text-stone-500 bg-stone-50 dark:bg-stone-800",
  },
};

const blockTypeLabel: Record<string, string> = {
  richtext: "Rich Text",
  table: "Table",
  code: "Code",
  response: "Response",
  callout: "Callout",
  image: "Image",
};

const CloseIcon = () => (
  <svg
    aria-hidden="true"
    className="w-4 h-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

export default function VersionDiff({
  itemId,
  currentBlocks,
  compareVersion,
  onClose,
  projectSlug,
}: Props) {
  const [oldData, setOldData] = useState<VersionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const url = projectSlug
      ? `/api/projects/${encodeURIComponent(projectSlug)}/spec/item/${encodeURIComponent(itemId)}/version/${compareVersion}`
      : `/api/spec/item/${encodeURIComponent(itemId)}/version/${compareVersion}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load version ${compareVersion}: ${res.statusText}`);
        return res.json();
      })
      .then((data) => {
        setOldData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [itemId, compareVersion, projectSlug]);

  const diff = oldData ? computeDiff(currentBlocks, oldData.blocks) : [];
  const changedCount = diff.filter((d) => d.status !== "unchanged").length;

  return (
    <div className="bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg mb-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">
            Comparing current with v{compareVersion}
          </span>
          {!loading && !error && (
            <span className="text-[11px] text-stone-400 dark:text-stone-600">
              {changedCount} block{changedCount !== 1 ? "s" : ""} changed
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 rounded transition-colors"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {loading && (
          <div className="text-xs text-stone-400 dark:text-stone-600 py-4 text-center">
            Loading version data...
          </div>
        )}

        {error && (
          <div className="text-xs text-red-500 dark:text-red-400 py-4 text-center">{error}</div>
        )}

        {!loading && !error && diff.length === 0 && (
          <div className="text-xs text-stone-400 dark:text-stone-600 py-4 text-center">
            No blocks to compare.
          </div>
        )}

        {!loading && !error && diff.length > 0 && (
          <div className="space-y-1.5">
            {diff.map((entry) => {
              const label = statusLabel[entry.status];

              return (
                <div
                  key={entry.block.id}
                  className={`border-l-4 ${borderColor[entry.status]} bg-white dark:bg-stone-900 rounded-r px-3 py-2 flex items-start gap-3`}
                >
                  {/* Block type */}
                  <div className="flex-shrink-0 w-16">
                    <span className="text-[10px] uppercase font-medium text-stone-400 dark:text-stone-600 tracking-wide">
                      {blockTypeLabel[entry.block.type] || entry.block.type}
                    </span>
                  </div>

                  {/* Summary */}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-stone-600 dark:text-stone-400 break-words">
                      {blockSummary(entry.block)}
                    </span>
                  </div>

                  {/* Status badge */}
                  {entry.status !== "unchanged" && (
                    <span
                      className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${label.className}`}
                    >
                      {label.text}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
