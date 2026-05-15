/**
 * blockToAdf — renders a single SpecGen Block to a flat list of ADF top-level
 * nodes (to be spliced into the parent `doc.content`).
 *
 * Mirrors `blockToMarkdown` exactly but emits ADF instead of Markdown strings.
 * Returns AdfNode[] (NOT AdfDoc) so the caller can interleave block output
 * with renderer-emitted nodes without nested wrapping.
 */

import type { Block } from "@specgen/core";
import { tiptapToAdf } from "./tiptapToAdf.js";
import type { AdfNode } from "./types.js";

const CALLOUT_PANEL_TYPE: Record<string, string> = {
  info: "info",
  warning: "warning",
  // Tiptap's "tip" maps to ADF's "success" panel — there's no native "tip"
  // panel in Confluence's schema, and "success" is the closest semantic.
  tip: "success",
  note: "note",
  error: "error",
};

export function blockToAdf(block: Block): AdfNode[] {
  switch (block.type) {
    case "richtext": {
      try {
        const parsed = JSON.parse(block.content ?? "{}");
        // Splice the body content; we don't wrap in another doc.
        return tiptapToAdf(parsed).content;
      } catch {
        // Fallback: treat as a single paragraph of raw text.
        return [
          {
            type: "paragraph",
            content: [{ type: "text", text: block.content ?? "" }],
          },
        ];
      }
    }

    case "table": {
      const cols = block.table?.columns ?? [];
      const rows = block.table?.rows ?? [];
      if (cols.length === 0) return [];
      const header: AdfNode = {
        type: "tableRow",
        content: cols.map((c) => ({
          type: "tableHeader",
          attrs: { colspan: 1, rowspan: 1 },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: c }],
            },
          ],
        })),
      };
      const body: AdfNode[] = rows.map((r) => ({
        type: "tableRow",
        content: r.map((cell) => ({
          type: "tableCell",
          attrs: { colspan: 1, rowspan: 1 },
          content: [
            {
              type: "paragraph",
              content: cell ? [{ type: "text", text: cell }] : [],
            },
          ],
        })),
      }));
      return [
        {
          type: "table",
          content: [header, ...body],
        },
      ];
    }

    case "code": {
      const lang = typeof block.meta?.language === "string" ? (block.meta.language as string) : "";
      const inner = block.content ?? "";
      return [
        {
          type: "codeBlock",
          attrs: lang ? { language: lang } : {},
          content: inner ? [{ type: "text", text: inner }] : [],
        },
      ];
    }

    case "response":
      // One `expand` per response — keeps the page scannable without burying
      // the JSON. Title carries the status + description; body is a single
      // JSON codeBlock.
      return (block.responses ?? []).map((r) => ({
        type: "expand",
        attrs: { title: `${r.status} — ${r.description}` },
        content: [
          {
            type: "codeBlock",
            attrs: { language: "json" },
            content: [{ type: "text", text: r.body }],
          },
        ],
      }));

    case "callout": {
      const variant = String(block.meta?.variant ?? "note").toLowerCase();
      const panelType = CALLOUT_PANEL_TYPE[variant] ?? "note";
      let content: AdfNode[] = [];
      try {
        content = tiptapToAdf(JSON.parse(block.content ?? "{}")).content;
      } catch {
        content = [
          {
            type: "paragraph",
            content: [{ type: "text", text: block.content ?? "" }],
          },
        ];
      }
      // A panel must have at least one block-level child (per ADF schema);
      // emit an empty paragraph if the source was empty.
      if (content.length === 0) {
        content = [{ type: "paragraph", content: [] }];
      }
      return [
        {
          type: "panel",
          attrs: { panelType },
          content,
        },
      ];
    }

    case "image": {
      // v0.2: text placeholder only. Attachment upload is v0.3 (decision F12).
      const src = typeof block.meta?.src === "string" ? (block.meta.src as string) : "";
      return [
        {
          type: "paragraph",
          content: [{ type: "text", text: `[Image: ${src}]` }],
        },
      ];
    }

    default:
      return [];
  }
}
