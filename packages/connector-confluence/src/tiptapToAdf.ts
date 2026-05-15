/**
 * tiptapToAdf — hand-written Tiptap doc JSON → ADF (Atlassian Document Format)
 * walker. Mirrors `@specgen/core`'s `tiptapToMarkdown` shape (recursive visit,
 * mark application) but emits ADF nodes instead of Markdown strings.
 *
 * Decision F7: no third-party `tiptap-adf` dep; we own the conversion so we
 * never silently break on a Tiptap-side schema bump.
 */

import type { AdfMark, AdfNode } from "./types.js";

type TiptapMark = { type: string; attrs?: Record<string, unknown> };
type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

/** Walk a Tiptap doc into a full ADF doc (with `version: 1`). */
export function tiptapToAdf(doc: TiptapNode | null | undefined): {
  version: 1;
  type: "doc";
  content: AdfNode[];
} {
  if (!doc) return { version: 1, type: "doc", content: [] };
  return {
    version: 1,
    type: "doc",
    content: renderChildren(doc.content),
  };
}

function renderChildren(nodes: TiptapNode[] | undefined = []): AdfNode[] {
  const out: AdfNode[] = [];
  for (const n of nodes) {
    const rendered = renderNode(n);
    if (Array.isArray(rendered)) out.push(...rendered);
    else if (rendered !== null) out.push(rendered);
  }
  return out;
}

function renderNode(node: TiptapNode): AdfNode | AdfNode[] | null {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", content: renderChildren(node.content) };

    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return {
        type: "heading",
        attrs: { level },
        content: renderChildren(node.content),
      };
    }

    case "text": {
      const out: AdfNode = { type: "text", text: node.text ?? "" };
      const marks = mapMarks(node.marks ?? []);
      if (marks.length) out.marks = marks;
      return out;
    }

    case "bulletList":
      return { type: "bulletList", content: renderChildren(node.content) };

    case "orderedList":
      return {
        type: "orderedList",
        attrs: { order: 1 },
        content: renderChildren(node.content),
      };

    case "listItem":
      return { type: "listItem", content: renderChildren(node.content) };

    case "blockquote":
      return { type: "blockquote", content: renderChildren(node.content) };

    case "horizontalRule":
      return { type: "rule" };

    case "hardBreak":
      return { type: "hardBreak" };

    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? (node.attrs.language as string) : "";
      return {
        type: "codeBlock",
        attrs: lang ? { language: lang } : {},
        content: renderChildren(node.content),
      };
    }

    case "details": {
      // ADF `expand` carries the summary as `attrs.title` — the summary
      // children are flattened to plain text. The body content is spliced
      // directly inside the expand.
      const summary = node.content?.find((c) => c.type === "detailsSummary");
      const body = node.content?.find((c) => c.type === "detailsContent");
      const title = flattenText(summary?.content).trim();
      return {
        type: "expand",
        attrs: { title },
        content: renderChildren(body?.content),
      };
    }

    // detailsSummary / detailsContent are handled by their parent above; when
    // encountered standalone we just unwrap their children.
    case "detailsSummary":
    case "detailsContent":
      return renderChildren(node.content);

    case "table":
      return { type: "table", content: renderChildren(node.content) };

    case "tableRow":
      return { type: "tableRow", content: renderChildren(node.content) };

    case "tableHeader":
      return {
        type: "tableHeader",
        attrs: { colspan: 1, rowspan: 1 },
        content: renderChildren(node.content),
      };

    case "tableCell":
      return {
        type: "tableCell",
        attrs: { colspan: 1, rowspan: 1 },
        content: renderChildren(node.content),
      };

    default:
      // Unknown node — emit its children so we don't drop text wholesale.
      return renderChildren(node.content);
  }
}

/**
 * Convert Tiptap marks to ADF marks. The mapping is:
 *   bold → strong
 *   italic → em
 *   code → code
 *   link → link  (preserves `href` attr; ADF's link mark uses the same key)
 *
 * Other marks (subscript, superscript, strike) round-trip with the same type
 * name so they're emitted as-is.
 */
function mapMarks(marks: TiptapMark[]): AdfMark[] {
  const out: AdfMark[] = [];
  for (const m of marks) {
    if (m.type === "bold") out.push({ type: "strong" });
    else if (m.type === "italic") out.push({ type: "em" });
    else if (m.type === "code") out.push({ type: "code" });
    else if (m.type === "link") {
      const href = typeof m.attrs?.href === "string" ? (m.attrs.href as string) : "";
      out.push({ type: "link", attrs: { href } });
    } else if (m.type === "strike") out.push({ type: "strike" });
    else if (m.type === "subsup") out.push({ type: "subsup", attrs: m.attrs });
    else out.push({ type: m.type, attrs: m.attrs });
  }
  return out;
}

/** Recursively flatten the text content of a node array — used for summary→title. */
function flattenText(nodes: TiptapNode[] | undefined): string {
  if (!nodes) return "";
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") out += n.text ?? "";
    else out += flattenText(n.content);
  }
  return out;
}
