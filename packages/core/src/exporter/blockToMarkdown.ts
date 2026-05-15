import type { Block } from "../spec/types.js";
import { fenceFor, tiptapToMarkdown } from "./tiptapToMarkdown.js";

/**
 * blockToMarkdown — renders a single Block to a Markdown string.
 */
export function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case "richtext": {
      try {
        return tiptapToMarkdown(JSON.parse(block.content ?? "{}"));
      } catch {
        return `${block.content ?? ""}\n\n`;
      }
    }

    case "table":
      return renderTable(block.table?.columns ?? [], block.table?.rows ?? []);

    case "code": {
      const lang = typeof block.meta?.language === "string" ? block.meta.language : "";
      const inner = block.content ?? "";
      const fence = fenceFor(inner);
      return `${fence}${lang}\n${inner}\n${fence}\n\n`;
    }

    case "response":
      return (block.responses ?? [])
        .map((r) => `### HTTP ${r.status} — ${r.description}\n\n\`\`\`json\n${r.body}\n\`\`\`\n\n`)
        .join("");

    case "callout": {
      const variant = String(block.meta?.variant ?? "note").toLowerCase();
      const tag = variant === "warning" ? "WARNING" : variant === "tip" ? "TIP" : "NOTE";
      let body = "";
      try {
        body = tiptapToMarkdown(JSON.parse(block.content ?? "{}")).trim();
      } catch {
        body = (block.content ?? "").trim();
      }
      const lines = body
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      return `> [!${tag}]\n${lines}\n\n`;
    }

    case "image":
      return `![${block.meta?.alt ?? ""}](${block.meta?.src ?? ""})\n\n`;

    default:
      return "";
  }
}

function renderTable(cols: string[], rows: string[][]): string {
  if (cols.length === 0) return "";
  const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n`;
  const body = rows.map((r) => `| ${r.map(escapeCell).join(" | ")} |`).join("\n");
  return `${head}${body}\n\n`;
}

function escapeCell(c: string): string {
  return c.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
