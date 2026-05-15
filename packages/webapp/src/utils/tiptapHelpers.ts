// Lightweight Tiptap helpers. wrapPlainText parses a "lightly marked-up"
// string (the kind the AI produces — `**bold**`, `(a) ... (b) ...` sub-items,
// `- ` bullets, `1. ` ordered items, `# ` headings, `\n\n` paragraph breaks,
// `\n` soft breaks, inline `*italic*` and `` `code` ``) into proper Tiptap
// block + mark nodes. unwrapPlainText is the inverse — lossy on whitespace
// but preserves structure + emphasis so edit -> save -> render is stable.

// ---------- Inline (text + marks) ----------

type Mark = { type: "bold" | "italic" | "code" };
type TextNode = { type: "text"; text: string; marks?: Mark[] };

/**
 * Parse a single line / segment of text into a run of `{type:'text', marks?}` nodes.
 * Handles **bold**, *italic*, and `code` inline. Left-to-right, non-greedy.
 * Backticked code wins over asterisks inside it (the asterisks are literal text).
 */
function parseInline(segment: string): TextNode[] {
  if (!segment) return [];
  const out: TextNode[] = [];
  let i = 0;
  let plain = "";
  const flushPlain = () => {
    if (plain) {
      out.push({ type: "text", text: plain });
      plain = "";
    }
  };
  while (i < segment.length) {
    const ch = segment[i];
    // Inline code: `...` (non-greedy, must close on same segment).
    if (ch === "`") {
      const close = segment.indexOf("`", i + 1);
      if (close > i + 1) {
        flushPlain();
        out.push({
          type: "text",
          text: segment.slice(i + 1, close),
          marks: [{ type: "code" }],
        });
        i = close + 1;
        continue;
      }
    }
    // Bold: **...**
    if (ch === "*" && segment[i + 1] === "*") {
      const close = segment.indexOf("**", i + 2);
      if (close > i + 2) {
        flushPlain();
        // Bold body may itself contain inline (*italic*, `code`).
        const inner = parseInline(segment.slice(i + 2, close));
        for (const node of inner) {
          out.push({
            ...node,
            marks: [...(node.marks || []), { type: "bold" }],
          });
        }
        i = close + 2;
        continue;
      }
    }
    // Italic: *...* (single asterisk). Be conservative: require non-space
    // immediately after the opener and a closing `*` not preceded by `*`.
    if (ch === "*" && segment[i + 1] !== "*" && segment[i + 1] !== " ") {
      // Find a closing single `*` (not part of `**`).
      let j = i + 1;
      let close = -1;
      while (j < segment.length) {
        if (segment[j] === "*" && segment[j + 1] !== "*" && segment[j - 1] !== "*") {
          close = j;
          break;
        }
        j++;
      }
      if (close > i + 1) {
        flushPlain();
        const inner = parseInline(segment.slice(i + 1, close));
        for (const node of inner) {
          out.push({
            ...node,
            marks: [...(node.marks || []), { type: "italic" }],
          });
        }
        i = close + 1;
        continue;
      }
    }
    plain += ch;
    i++;
  }
  flushPlain();
  return out;
}

// ---------- Block parser ----------

type ParagraphNode = { type: "paragraph"; content: (TextNode | { type: "hardBreak" })[] };
type HeadingNode = {
  type: "heading";
  attrs: { level: number };
  content: TextNode[];
};
type ListItemNode = { type: "listItem"; content: ParagraphNode[] };
type BulletListNode = { type: "bulletList"; content: ListItemNode[] };
type OrderedListNode = { type: "orderedList"; content: ListItemNode[] };
type CodeBlockNode = {
  type: "codeBlock";
  attrs?: { language?: string | null };
  content: TextNode[];
};
type DetailsSummaryNode = { type: "detailsSummary"; content: TextNode[] };
type DetailsContentNode = {
  type: "detailsContent";
  content: (ParagraphNode | CodeBlockNode)[];
};
type DetailsNode = {
  type: "details";
  attrs: { open: boolean };
  content: [DetailsSummaryNode, DetailsContentNode];
};
type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | CodeBlockNode
  | DetailsNode;

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_DASH_RE = /^[\-*]\s+(.*)$/;
const BULLET_LETTER_RE = /^\(([a-z])\)\s+(.*)$/i;
const BULLET_ROMAN_RE = /^\((i{1,3}|iv|v|vi{0,3}|ix|x)\)\s+(.*)$/i;
const ORDERED_RE = /^(\d+)\.\s+(.*)$/;
// Fenced code block opener: ``` optionally followed by a language hint like
// `json`, `{json}`, `ts`, etc. Closing fence is plain ``` (no info string).
const FENCE_OPEN_RE = /^```\s*\{?([A-Za-z0-9_+-]*)\}?\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;
// "Summary —" or "Details:" prefix on a paragraph line. The em-dash (—) and
// the ASCII "--" / "-" are all accepted because AI output varies. The prefix
// is consumed; the rest of the line becomes the summary text. If the next
// node parsed is a code block, the two get merged into a `details` node.
const DETAILS_PREFIX_RE = /^(?:Summary|Details)\s*(?:—|--|-|:)\s*(.*)$/;

type LineKind =
  | { kind: "blank" }
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "ordered"; text: string }
  | { kind: "paragraph"; text: string };

function classifyLine(line: string): LineKind {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "blank" };
  let m = trimmed.match(HEADING_RE);
  if (m) return { kind: "heading", level: Math.min(m[1].length, 3), text: m[2] };
  m = trimmed.match(BULLET_LETTER_RE);
  if (m) return { kind: "bullet", text: m[2] };
  m = trimmed.match(BULLET_ROMAN_RE);
  if (m) return { kind: "bullet", text: m[2] };
  m = trimmed.match(BULLET_DASH_RE);
  if (m) return { kind: "bullet", text: m[1] };
  m = trimmed.match(ORDERED_RE);
  if (m) return { kind: "ordered", text: m[2] };
  return { kind: "paragraph", text: trimmed };
}

/**
 * Parse a multi-line "lightly marked-up" string into Tiptap block nodes.
 * Exported for testing.
 */
export function parseLightMarkdown(text: string): BlockNode[] {
  const out: BlockNode[] = [];
  const lines = text.split("\n");
  let currentParagraph: ParagraphNode | null = null;
  let currentBulletList: BulletListNode | null = null;
  let currentOrderedList: OrderedListNode | null = null;

  const closeAll = () => {
    if (currentParagraph) {
      out.push(currentParagraph);
      currentParagraph = null;
    }
    if (currentBulletList) {
      out.push(currentBulletList);
      currentBulletList = null;
    }
    if (currentOrderedList) {
      out.push(currentOrderedList);
      currentOrderedList = null;
    }
  };
  const closeLists = () => {
    if (currentBulletList) {
      out.push(currentBulletList);
      currentBulletList = null;
    }
    if (currentOrderedList) {
      out.push(currentOrderedList);
      currentOrderedList = null;
    }
  };
  const closeParagraph = () => {
    if (currentParagraph) {
      out.push(currentParagraph);
      currentParagraph = null;
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    // Fenced code block: ``` (with optional `lang` or `{lang}`) ... ```.
    // Detected pre-classify because fences may contain content that would
    // otherwise be classified as bullets/headings.
    const fenceOpen = raw.match(FENCE_OPEN_RE);
    if (fenceOpen) {
      closeAll();
      const lang = fenceOpen[1] || null;
      const bodyLines: string[] = [];
      idx++;
      while (idx < lines.length && !FENCE_CLOSE_RE.test(lines[idx])) {
        bodyLines.push(lines[idx]);
        idx++;
      }
      // idx is now at the closing fence (or end of input — accept either).
      out.push({
        type: "codeBlock",
        attrs: { language: lang },
        content: [{ type: "text", text: bodyLines.join("\n") }],
      });
      continue;
    }
    const c = classifyLine(raw);
    if (c.kind === "blank") {
      closeAll();
      continue;
    }
    if (c.kind === "heading") {
      closeAll();
      out.push({
        type: "heading",
        attrs: { level: c.level },
        content: parseInline(c.text),
      });
      continue;
    }
    if (c.kind === "bullet") {
      closeParagraph();
      if (currentOrderedList) {
        out.push(currentOrderedList);
        currentOrderedList = null;
      }
      const item: ListItemNode = {
        type: "listItem",
        content: [{ type: "paragraph", content: parseInline(c.text) }],
      };
      if (currentBulletList) {
        currentBulletList.content.push(item);
      } else {
        currentBulletList = { type: "bulletList", content: [item] };
      }
      continue;
    }
    if (c.kind === "ordered") {
      closeParagraph();
      if (currentBulletList) {
        out.push(currentBulletList);
        currentBulletList = null;
      }
      const item: ListItemNode = {
        type: "listItem",
        content: [{ type: "paragraph", content: parseInline(c.text) }],
      };
      if (currentOrderedList) {
        currentOrderedList.content.push(item);
      } else {
        currentOrderedList = { type: "orderedList", content: [item] };
      }
      continue;
    }
    // paragraph
    closeLists();
    const inline = parseInline(c.text);
    if (currentParagraph) {
      currentParagraph.content.push({ type: "hardBreak" });
      currentParagraph.content.push(...inline);
    } else {
      currentParagraph = { type: "paragraph", content: inline };
    }
  }
  closeAll();
  return mergeDetailsBlocks(out);
}

/**
 * Post-process pass: a `paragraph` whose text starts with `Summary —` or
 * `Details:` followed immediately by a `codeBlock` gets merged into a single
 * `details` node. The prefix is stripped from the summary; the code block
 * becomes the body. Used so AI-generated content like:
 *
 *   Summary — Response — GET /api/foo
 *   ```json
 *   { "id": 7 }
 *   ```
 *
 * renders as a collapsible block. If the paragraph has no trailing code
 * block, it is left alone (no merge).
 */
function mergeDetailsBlocks(blocks: BlockNode[]): BlockNode[] {
  const out: BlockNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i];
    const next = blocks[i + 1];
    if (cur.type === "paragraph" && next && next.type === "codeBlock") {
      const summaryText = paragraphPlainText(cur);
      const m = summaryText.match(DETAILS_PREFIX_RE);
      if (m) {
        const summary = m[1].trim() || "Details";
        out.push({
          type: "details",
          attrs: { open: false },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: summary }] },
            { type: "detailsContent", content: [next] },
          ],
        });
        i++; // consume the code block too
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}

/** Flatten a paragraph's inline content to a plain string (drops marks +
 *  hardBreaks). Used only for the details-prefix detection. */
function paragraphPlainText(p: ParagraphNode): string {
  return p.content
    .map((n) => (n.type === "hardBreak" ? "\n" : n.text || ""))
    .join("")
    .trim();
}

/** Wrap a plain string as Tiptap JSON so it renders in the editor */
export function wrapPlainText(text: string): string {
  if (!text) return "";
  // Pre-existing escape hatch: if input is already Tiptap JSON, pass through.
  if (text.startsWith("{")) {
    try {
      JSON.parse(text);
      return text;
    } catch {
      /* fall through to parser */
    }
  }
  const blocks = parseLightMarkdown(text);
  // Tiptap requires a doc to have at least one block-level child.
  const content = blocks.length > 0 ? blocks : [{ type: "paragraph", content: [] }];
  return JSON.stringify({ type: "doc", content });
}

/** Wrap text as a Tiptap heading node */
export function wrapHeading(text: string, level = 2): string {
  if (!text) return "";
  return JSON.stringify({
    type: "doc",
    content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text }] }],
  });
}

// ---------- Unwrap (doc -> light markdown) ----------

type AnyNode = {
  type: string;
  text?: string;
  marks?: { type: string }[];
  attrs?: { level?: number };
  content?: AnyNode[];
};

function renderInline(nodes: AnyNode[] | undefined): string {
  if (!nodes) return "";
  let out = "";
  for (const n of nodes) {
    if (n.type === "hardBreak") {
      out += "\n";
      continue;
    }
    if (n.type !== "text") {
      // Recurse defensively (shouldn't happen for inline runs, but be safe).
      out += renderInline(n.content);
      continue;
    }
    let s = n.text || "";
    const marks = (n.marks || []).map((m) => m.type);
    if (marks.includes("code")) s = `\`${s}\``;
    if (marks.includes("italic")) s = `*${s}*`;
    if (marks.includes("bold")) s = `**${s}**`;
    out += s;
  }
  return out;
}

function letterMarker(index: number): string {
  // 0 -> a, 1 -> b, ... 25 -> z. Fall back to `- ` beyond.
  if (index < 26) return `(${String.fromCharCode(97 + index)}) `;
  return "- ";
}

function renderBlock(node: AnyNode): string {
  if (node.type === "paragraph") {
    return renderInline(node.content);
  }
  if (node.type === "heading") {
    const level = Math.max(1, Math.min(6, node.attrs?.level || 2));
    return `${"#".repeat(level)} ${renderInline(node.content)}`;
  }
  if (node.type === "bulletList") {
    const items = node.content || [];
    return items
      .map((item, idx) => {
        const first = (item.content || [])[0];
        const body = first?.type === "paragraph" ? renderInline(first.content) : "";
        return `${letterMarker(idx)}${body}`;
      })
      .join("\n");
  }
  if (node.type === "orderedList") {
    const items = node.content || [];
    return items
      .map((item, idx) => {
        const first = (item.content || [])[0];
        const body = first?.type === "paragraph" ? renderInline(first.content) : "";
        return `${idx + 1}. ${body}`;
      })
      .join("\n");
  }
  if (node.type === "codeBlock") {
    // attrs.language may be string | null | undefined.
    const lang = (node.attrs as { language?: string | null } | undefined)?.language;
    const body = (node.content || []).map((n) => n.text || "").join("");
    return `\`\`\`${lang || ""}\n${body}\n\`\`\``;
  }
  if (node.type === "details") {
    // Render as "Summary — <summary>\n```lang\n<body>\n```" so wrapPlainText
    // can re-parse it back into a details node. If the body isn't a code
    // block (shouldn't happen in practice — the only way to construct a
    // details node via parseLightMarkdown is with a fenced code block), fall
    // back to a paragraph "Summary — <summary>\n<body...>" without merging.
    const summaryNode = (node.content || []).find((n) => n.type === "detailsSummary");
    const contentNode = (node.content || []).find((n) => n.type === "detailsContent");
    const summary = summaryNode ? renderInline(summaryNode.content) : "Details";
    const bodyNodes = contentNode?.content || [];
    const renderedBody = bodyNodes.map(renderBlock).join("\n\n");
    return `Summary — ${summary}\n${renderedBody}`;
  }
  // Fallback: recurse into anything else (e.g. blockquote) as plain text.
  return renderInline(node.content);
}

/**
 * Extract a "light markdown" representation from Tiptap JSON for saving back
 * to a plain-string field. Inverse of wrapPlainText (lossy on whitespace, but
 * preserves structure + emphasis so edit -> save -> render is stable).
 */
export function unwrapPlainText(json: string): string {
  if (!json) return "";
  let doc: AnyNode;
  try {
    doc = JSON.parse(json) as AnyNode;
  } catch {
    return json;
  }
  const blocks = doc.content || [];
  return blocks.map(renderBlock).join("\n\n");
}
