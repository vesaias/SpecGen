import { useBlocks } from "../hooks/useBlocks";
import type { Block, BlockType, FrontendItem, SpecItem } from "../types";
import { wrapHeading, wrapPlainText } from "../utils/tiptapHelpers";
import BlockList from "./blocks/BlockList";

interface Props {
  item: FrontendItem;
  editable: boolean;
  version: string;
  editToggle: React.ReactNode;
  onUpdate: (updates: Partial<SpecItem>) => void;
  /** Project slug — used to resolve capture screenshot URLs against the API. */
  projectSlug?: string;
}

/**
 * Resolve a screenshot path into a fetchable URL. The capture generator
 * writes paths like "captures/<itemId>.png" (relative to the project's data
 * dir); we map those to the project-scoped static-serve endpoint. Anything
 * absolute (`http`, `/...`) is passed through unchanged.
 */
function resolveScreenshotUrl(src: string, projectSlug?: string): string {
  if (!src) return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")) {
    return src;
  }
  if (projectSlug && src.startsWith("captures/")) {
    const file = src.slice("captures/".length);
    return `/api/v0/projects/${encodeURIComponent(projectSlug)}/captures/${encodeURIComponent(file)}`;
  }
  return src;
}

/** Build the inline paragraph for one action (description + endpoint + success/error). */
function actionParagraphMarkdown(
  action: FrontendItem["actions"][number],
  description: string | undefined,
): string {
  const lines: string[] = [];
  if (description) lines.push(description);
  if (action.endpoint) {
    const m = action.method ? action.method.toUpperCase() : "";
    const ep = action.endpoint;
    const display = m && !ep.toUpperCase().startsWith(m) ? `${m} ${ep}` : ep;
    lines.push(`**Endpoint:** \`${display}\``);
  }
  if (action.onSuccess) lines.push(`**On success:** ${action.onSuccess}`);
  if (action.onError) lines.push(`**On error:** ${action.onError}`);
  if (Array.isArray(action.clientValidation) && action.clientValidation.length > 0) {
    lines.push(`**Validation:** ${action.clientValidation.join(", ")}`);
  }
  return lines.join("\n\n");
}

type ObservedSection = NonNullable<FrontendItem["observedSections"]>[number];

/** Inline meta for an observed section row (table columns / row count). */
function sectionMetaLine(section: ObservedSection): string {
  const parts: string[] = [];
  if (section.tableColumns && section.tableColumns.length > 0) {
    parts.push(`Columns: ${section.tableColumns.join(", ")}`);
  }
  if (typeof section.tableRowCount === "number") {
    parts.push(`${section.tableRowCount} row${section.tableRowCount === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function buildDefaultBlocks(item: FrontendItem, projectSlug?: string): Block[] {
  const blocks: Block[] = [];

  // -------------------------------------------------------------------------
  // 1. Header narrative — summary + context paragraph
  // -------------------------------------------------------------------------
  const intro = [item.summary, item.context].filter(Boolean).join("\n\n");
  if (intro) {
    blocks.push({ id: "context", type: "richtext", content: wrapPlainText(intro) });
  }

  // -------------------------------------------------------------------------
  // 2. Screenshot
  // -------------------------------------------------------------------------
  if (item.screenshot) {
    blocks.push({
      id: "screenshot",
      type: "image",
      meta: { src: resolveScreenshotUrl(item.screenshot, projectSlug) },
    });
  }

  // -------------------------------------------------------------------------
  // 3. On Page Load — narrative + endpoint table
  // -------------------------------------------------------------------------
  const hasOnLoad = item.apiCalls?.length > 0 || Boolean(item.onLoadDescription);
  if (hasOnLoad) {
    blocks.push({
      id: "onload-heading",
      type: "richtext",
      content: wrapHeading("On Page Load", 3),
    });
    if (item.onLoadDescription) {
      blocks.push({
        id: "onload-desc",
        type: "richtext",
        content: wrapPlainText(item.onLoadDescription),
      });
    }
    if (item.apiCalls?.length > 0) {
      blocks.push({
        id: "onload-api",
        type: "table",
        table: {
          columns: ["Method", "Endpoint", "Hook"],
          rows: item.apiCalls.map((a) => [a.method, a.endpoint, a.hook]),
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Page Sections — high-level: heading + AI description + meta line
  //     (raw elements are pushed to the bottom as an inventory)
  // -------------------------------------------------------------------------
  const sectionDescs = item.sectionDescriptions ?? {};
  const observedById = new Map<string, ObservedSection>();
  for (const o of item.observedSections ?? []) {
    observedById.set((o.heading || o.selector).toLowerCase(), o);
  }
  const namedSections = (item.sections ?? []).filter(
    (s) => sectionDescs[s.id] || s.elements.length > 0,
  );
  if (namedSections.length > 0) {
    blocks.push({
      id: "sections-heading",
      type: "richtext",
      content: wrapHeading("Page Sections", 3),
    });
    for (const section of namedSections) {
      const desc = sectionDescs[section.id];
      const obs =
        observedById.get(section.id.toLowerCase()) ??
        observedById.get((section.component || "").toLowerCase());
      const observedMeta = obs ? sectionMetaLine(obs) : "";
      const observedHeading = obs?.heading && obs.heading !== section.id ? obs.heading : "";
      const parts: string[] = [];
      parts.push(`#### ${observedHeading || section.id}`);
      if (desc) parts.push(desc);
      if (observedMeta) parts.push(`*${observedMeta}*`);
      blocks.push({
        id: `section-${section.id}`,
        type: "richtext",
        content: wrapPlainText(parts.join("\n\n")),
      });
    }
  }

  // -------------------------------------------------------------------------
  // 5. User Actions — per-action heading + narrative + endpoint line
  // -------------------------------------------------------------------------
  const actionDescs = item.actionDescriptions ?? {};
  // De-dup actions that are really page-load (their trigger mentions "load" or "mount").
  const userActions = (item.actions ?? []).filter(
    (a) => !/page\s*load|on\s*mount/i.test(a.trigger),
  );
  if (userActions.length > 0) {
    blocks.push({
      id: "actions-heading",
      type: "richtext",
      content: wrapHeading("User Actions", 3),
    });
    for (const action of userActions) {
      const desc = actionDescs[action.trigger];
      const md = `**${action.trigger}**\n\n${actionParagraphMarkdown(action, desc)}`;
      blocks.push({
        id: `action-${action.trigger.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        type: "richtext",
        content: wrapPlainText(md),
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Navigation
  // -------------------------------------------------------------------------
  if (item.navigation?.length > 0) {
    blocks.push({ id: "nav-heading", type: "richtext", content: wrapHeading("Navigation", 3) });
    blocks.push({
      id: "nav",
      type: "table",
      table: {
        columns: ["Destination", "Trigger", "Condition"],
        rows: item.navigation.map((n) => [n.to, n.trigger, n.condition]),
      },
    });
  }

  // -------------------------------------------------------------------------
  // 7. Live capture observations — XHR + landed URL summary
  //     Only shown when capture has actually run.
  // -------------------------------------------------------------------------
  if (item.observedApiCalls && item.observedApiCalls.length > 0) {
    blocks.push({
      id: "observed-heading",
      type: "richtext",
      content: wrapHeading("Live Browser Capture", 3),
    });
    const summaryParts: string[] = [];
    if (item.landedH1) summaryParts.push(`H1: **${item.landedH1}**`);
    if (item.landedUrl) summaryParts.push(`URL: \`${item.landedUrl}\``);
    if (typeof item.captureNavStatus === "number") {
      summaryParts.push(`HTTP **${item.captureNavStatus}**`);
    }
    if (summaryParts.length > 0) {
      blocks.push({
        id: "observed-summary",
        type: "richtext",
        content: wrapPlainText(summaryParts.join(" · ")),
      });
    }
    blocks.push({
      id: "observed-api",
      type: "table",
      table: {
        columns: ["Method", "URL", "Status"],
        rows: item.observedApiCalls.map((a) => [a.method, a.url, String(a.status)]),
      },
    });
  }

  // -------------------------------------------------------------------------
  // 8. Element Inventory — raw per-section element tables, at the bottom.
  //     Useful for completeness but visually dominant if pushed to the top.
  // -------------------------------------------------------------------------
  const sectionsWithElements = item.sections?.filter((s) => s.elements.length > 0) ?? [];
  if (sectionsWithElements.length > 0) {
    blocks.push({
      id: "inventory-heading",
      type: "richtext",
      content: wrapHeading("Element Inventory", 3),
    });
    for (const section of sectionsWithElements) {
      blocks.push({
        id: `inventory-${section.id}-heading`,
        type: "richtext",
        content: wrapPlainText(`**${section.id}** — \`${section.component}\``),
      });
      blocks.push({
        id: `inventory-${section.id}`,
        type: "table",
        table: {
          columns: ["Element", "Text/Label", "Source"],
          rows: section.elements.map((e) => [
            e.tag + (e.type ? `[${e.type}]` : ""),
            e.text || e.name || "",
            e.source,
          ]),
        },
      });
    }
  }

  return blocks;
}

export default function FrontendPage({
  item,
  editable,
  version,
  editToggle,
  onUpdate,
  projectSlug,
}: Props) {
  const { blocks, updateBlockContent, insertBlock, deleteBlock, reorderBlocks } = useBlocks(
    item,
    editable,
    () => buildDefaultBlocks(item, projectSlug),
    onUpdate,
  );

  return (
    <div className="p-6 lg:p-8">
      {item.captureAuthLikelyFailed && (
        <div className="mb-4 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm">
          <strong>Auth likely failed during capture.</strong>{" "}
          {item.captureNavStatus === 401 || item.captureNavStatus === 403
            ? `Page navigation returned HTTP ${item.captureNavStatus}.`
            : "Most observed XHR/fetch calls returned 401/403."}{" "}
          Use <strong>Test connection</strong> in Settings → Capture to verify credentials, then
          re-capture.
        </div>
      )}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <span className="bg-violet-500 text-white text-xs font-bold uppercase px-3 py-1.5 rounded-md tracking-wide">
            Page
          </span>
          <h1 className="text-xl font-semibold text-stone-800 dark:text-stone-100 flex-1">
            {item.title}
          </h1>
          {editToggle}
        </div>
        <div className="flex items-center gap-3 mt-3 text-xs text-stone-400 dark:text-stone-600">
          <span className="bg-brand-600 dark:bg-brand-500 text-white px-2 py-0.5 rounded text-[10px] font-semibold">
            {version}
          </span>
          {item.route && (
            <code className="font-mono text-stone-500 dark:text-stone-400">{item.route}</code>
          )}
        </div>
        {item.sourceFiles?.length > 0 && (
          <details className="mt-1.5 text-[11px] text-stone-400 dark:text-stone-600">
            <summary className="cursor-pointer hover:text-brand-600 dark:hover:text-brand-300">
              {item.sourceFiles?.length} source file{item.sourceFiles?.length > 1 ? "s" : ""}
            </summary>
            <div className="mt-1 pl-4 font-mono">
              {item.sourceFiles.map((f) => (
                <div key={f}>{f}</div>
              ))}
            </div>
          </details>
        )}
      </div>

      <BlockList
        blocks={blocks}
        item={item}
        editable={editable}
        onInsertBlock={insertBlock}
        onUpdateBlock={updateBlockContent}
        onDeleteBlock={deleteBlock}
        onReorder={reorderBlocks}
      />
    </div>
  );
}
