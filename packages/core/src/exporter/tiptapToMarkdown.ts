/**
 * tiptapToMarkdown — hand-written Tiptap doc JSON → Markdown walker.
 *
 * Decision PD7: no tiptap-markdown dep; we own the full conversion.
 */

/**
 * fenceFor — return a backtick fence string that is longer than any run of
 * backticks inside `content`, so the fence is never broken by content.
 */
export function fenceFor(content: string): string {
  let longest = 0;
  for (const m of content.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}

type TiptapMark = { type: string; attrs?: Record<string, unknown> };
type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

export function tiptapToMarkdown(doc: TiptapNode | null | undefined): string {
  if (!doc) return "";
  return renderChildren(doc.content).replace(/\n{3,}/g, "\n\n");
}

function renderChildren(nodes: TiptapNode[] = []): string {
  return nodes.map(renderNode).join("");
}

function renderNode(node: TiptapNode): string {
  switch (node.type) {
    case "paragraph":
      return `${renderChildren(node.content)}\n\n`;

    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return `${"#".repeat(level)} ${renderChildren(node.content)}\n\n`;
    }

    case "text":
      return applyMarks(node.text ?? "", node.marks ?? []);

    case "bulletList":
      return renderList(node.content ?? [], () => "- ");

    case "orderedList": {
      let n = 0;
      return renderList(node.content ?? [], () => `${++n}. `);
    }

    case "listItem":
      return renderChildren(node.content).trim();

    case "blockquote": {
      const inner = renderChildren(node.content);
      const quoted = inner
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n")
        .replace(/\n$/, "");
      return `${quoted}\n\n`;
    }

    case "horizontalRule":
      return "---\n\n";

    case "hardBreak":
      return "  \n";

    case "codeBlock": {
      const lang = (node.attrs?.language as string | undefined) ?? "";
      const inner = renderChildren(node.content);
      const fence = fenceFor(inner);
      return `${fence}${lang}\n${inner}\n${fence}\n\n`;
    }

    case "details": {
      const summary = node.content?.find((c) => c.type === "detailsSummary");
      const body = node.content?.find((c) => c.type === "detailsContent");
      const summaryText = renderChildren(summary?.content).trim();
      const bodyText = renderChildren(body?.content);
      return `<details>\n<summary>${summaryText}</summary>\n\n${bodyText}\n</details>\n\n`;
    }

    case "detailsSummary":
    case "detailsContent":
      return renderChildren(node.content);

    default:
      return renderChildren(node.content);
  }
}

function renderList(items: TiptapNode[], marker: (i: number) => string): string {
  return items.map((li, i) => `${marker(i)}${renderChildren(li.content).trim()}\n`).join("");
}

function applyMarks(text: string, marks: TiptapMark[]): string {
  // Apply inline marks first, then wrap the result in a link last so the link
  // is the outermost syntax — this is what CommonMark prefers for bold-linked
  // text and other combinations.
  const inlineMarks = marks.filter((m) => m.type !== "link");
  const linkMark = marks.find((m) => m.type === "link");
  let out = text;
  for (const m of inlineMarks) {
    if (m.type === "bold") out = `**${out}**`;
    else if (m.type === "italic") out = `*${out}*`;
    else if (m.type === "code") out = `\`${out}\``;
  }
  if (linkMark && typeof linkMark.attrs?.href === "string") {
    out = `[${out}](${linkMark.attrs.href})`;
  }
  return out;
}
