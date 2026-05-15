/**
 * renderItemAdf — walk a SpecItem's typed fields + blocks into a full AdfDoc.
 *
 * Mirrors the structure of @specgen/core's `renderItemMarkdown` exactly:
 *   summary blockquote → context → typed sections (parameters/responses/...) → blocks
 *
 * Two-pass support (decision F8): the `stubLinks` option controls how internal
 * `#item-id` hrefs render. In pass 1 we leave them as plain text "#item-id"
 * (Confluence won't accept fragment URLs as link marks anyway). In pass 2 the
 * `resolveItemUrl` callback rewrites each fragment to an absolute page URL.
 */

import type {
  BackendSpecItem,
  Block,
  EventSpecItem,
  FrontendSpecItem,
  HandlerSpecItem,
  SpecItem,
} from "@specgen/core";
import { blockToAdf } from "./blockToAdf.js";
import type { AdfDoc, AdfNode } from "./types.js";

type SpecItemWithBlocks = SpecItem & { blocks?: Block[] };

export interface RenderItemAdfOpts {
  /**
   * Pass 1 — internal `#fragment` links are left as plain text and the link
   * mark is dropped. Pass 2 — `#fragment` is rewritten via `resolveItemUrl`.
   */
  stubLinks: boolean;
  /**
   * Pass 2 only: map an item id to its absolute Confluence page URL. Returning
   * null leaves the link as plain text (e.g. the target item was archived).
   */
  resolveItemUrl?: (itemId: string) => string | null;
}

export function renderItemAdf(item: SpecItemWithBlocks, opts: RenderItemAdfOpts): AdfDoc {
  const content: AdfNode[] = [];

  // H1 title — the page title is also set via createPage/updatePage, but the
  // in-body H1 helps users who view the page in Confluence's tree without
  // breadcrumbs.
  content.push({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: item.title }],
  });

  switch (item.type) {
    case "backend":
      content.push(...renderBackend(item as BackendSpecItem));
      break;
    case "frontend":
      content.push(...renderFrontend(item as FrontendSpecItem));
      break;
    case "event":
      content.push(...renderEvent(item as EventSpecItem));
      break;
    case "handler":
      content.push(...renderHandler(item as HandlerSpecItem));
      break;
  }

  // Notes section: SpecGen blocks attached to the item.
  if (item.blocks?.length) {
    content.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Notes" }],
    });
    for (const block of item.blocks) {
      content.push(...blockToAdf(block));
    }
  }

  // Walk the produced tree to resolve link marks per pass.
  return {
    version: 1,
    type: "doc",
    content: postProcessLinks(content, opts),
  };
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

function renderBackend(item: BackendSpecItem): AdfNode[] {
  const out: AdfNode[] = [];

  if (item.summary) {
    out.push({
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: item.summary }],
        },
      ],
    });
  }

  if (item.context) {
    out.push(heading2("Context"));
    out.push(paragraph(item.context));
  }

  if (item.parameters?.length) {
    out.push(heading2("Parameters"));
    out.push(
      simpleTable(
        ["Name", "In", "Type", "Required", "Description"],
        item.parameters.map((p) => [
          p.name,
          p.location,
          p.type,
          p.required ? "yes" : "no",
          p.description ?? "",
        ]),
      ),
    );
  }

  if (item.requestBody) {
    out.push(heading2(`Request body — ${item.requestBody.dtoName}`));
    out.push(
      simpleTable(
        ["Field", "Type", "Required", "Description", "Validation"],
        item.requestBody.fields.map((f) => [
          f.name,
          f.type,
          f.required ? "yes" : "no",
          f.description ?? "",
          f.validation ?? "",
        ]),
      ),
    );
  }

  if (item.orchestration?.length) {
    out.push(heading2("Orchestration"));
    out.push({
      type: "orderedList",
      attrs: { order: 1 },
      content: item.orchestration.map((s) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: `${s.call} — `, marks: [{ type: "strong" }] },
              { type: "text", text: s.description },
            ],
          },
        ],
      })),
    });
  }

  if (item.responses?.length) {
    out.push(heading2("Responses"));
    for (const r of item.responses) {
      const title = `HTTP ${r.status}${r.type ? ` (${r.type})` : ""}${r.description ? ` — ${r.description}` : ""}`;
      const inner: AdfNode[] = [];
      if (r.responseExample) {
        inner.push({
          type: "codeBlock",
          attrs: { language: "json" },
          content: [{ type: "text", text: r.responseExample }],
        });
      } else {
        inner.push({ type: "paragraph", content: [] });
      }
      out.push({
        type: "expand",
        attrs: { title },
        content: inner,
      });
    }
  }

  if (item.validationRules?.length) {
    out.push(heading2("Validation rules"));
    out.push(
      simpleTable(
        ["Field", "Rule", "Message"],
        item.validationRules.map((v) => [v.field, v.rule, v.message ?? ""]),
      ),
    );
  }

  if (item.dependencies?.length) {
    out.push(heading2("Dependencies"));
    out.push({
      type: "bulletList",
      content: item.dependencies.map((d) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: d }] }],
      })),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------

function renderFrontend(item: FrontendSpecItem): AdfNode[] {
  const out: AdfNode[] = [];

  if (item.context) {
    out.push(heading2("Context"));
    out.push(paragraph(item.context));
  }

  if (item.sections?.length) {
    out.push(heading2("Sections"));
    for (const s of item.sections) {
      out.push({
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: `${s.id} — ${s.component}` }],
      });
      if (s.elements?.length) {
        out.push(
          simpleTable(
            ["Tag", "Type", "Name", "Editable", "Source"],
            s.elements.map((e) => [
              e.tag,
              e.type ?? "",
              e.name ?? "",
              e.editable ? "yes" : "no",
              e.source ?? "",
            ]),
          ),
        );
      }
    }
  }

  if (item.state?.length) {
    out.push(heading2("State"));
    out.push(
      simpleTable(
        ["Name", "Type", "Initial value"],
        item.state.map((s) => [s.name, s.type, s.initialValue ?? ""]),
      ),
    );
  }

  if (item.actions?.length) {
    out.push(heading2("Actions"));
    out.push(
      simpleTable(
        ["Trigger", "Method", "Endpoint", "On success", "On error"],
        item.actions.map((a) => [
          a.trigger,
          a.method ?? "",
          a.endpoint ?? "",
          a.onSuccess ?? "",
          a.onError ?? "",
        ]),
      ),
    );
  }

  if (item.navigation?.length) {
    out.push(heading2("Navigation"));
    out.push(
      simpleTable(
        ["To", "Trigger", "Condition"],
        item.navigation.map((n) => [n.to, n.trigger, n.condition ?? ""]),
      ),
    );
  }

  if (item.apiCalls?.length) {
    out.push(heading2("API calls"));
    out.push(
      simpleTable(
        ["Hook", "Type", "Method", "Endpoint"],
        item.apiCalls.map((c) => [c.hook, c.type, c.method, c.endpoint]),
      ),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

function renderEvent(item: EventSpecItem): AdfNode[] {
  const out: AdfNode[] = [];

  if (item.summary) {
    out.push({
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: item.summary }] }],
    });
  }
  if (item.context) {
    out.push(heading2("Context"));
    out.push(paragraph(item.context));
  }
  if (item.payload?.length) {
    out.push(heading2("Payload"));
    out.push(
      simpleTable(
        ["Field", "Type", "Description"],
        item.payload.map((p) => [p.name, p.type, p.description ?? ""]),
      ),
    );
  }
  if (item.payloadExample) {
    out.push({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Example" }],
    });
    out.push({
      type: "codeBlock",
      attrs: { language: "json" },
      content: [{ type: "text", text: item.payloadExample }],
    });
  }
  if (item.triggers?.length) {
    out.push(heading2("Triggers"));
    out.push(
      simpleTable(
        ["Service", "Method", "Endpoint"],
        item.triggers.map((t) => [t.service, t.method, t.endpoint ?? ""]),
      ),
    );
  }
  if (item.handler) {
    out.push(heading2("Handler"));
    out.push({
      type: "paragraph",
      content: [{ type: "text", text: item.handler, marks: [{ type: "code" }] }],
    });
    if (item.handlerDescription) {
      out.push(paragraph(item.handlerDescription));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function renderHandler(item: HandlerSpecItem): AdfNode[] {
  const out: AdfNode[] = [];
  if (item.description) out.push(paragraph(item.description));
  if (item.listensTo?.length) {
    out.push(heading2("Listens to"));
    out.push({
      type: "bulletList",
      content: item.listensTo.map((e) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: e, marks: [{ type: "code" }] }],
          },
        ],
      })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function heading2(text: string): AdfNode {
  return {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text }],
  };
}

function paragraph(text: string): AdfNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function simpleTable(cols: string[], rows: string[][]): AdfNode {
  return {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: cols.map((c) => ({
          type: "tableHeader",
          attrs: { colspan: 1, rowspan: 1 },
          content: [paragraph(c)],
        })),
      },
      ...rows.map((r) => ({
        type: "tableRow",
        content: r.map((cell) => ({
          type: "tableCell",
          attrs: { colspan: 1, rowspan: 1 },
          content: [paragraph(cell)],
        })),
      })),
    ],
  };
}

/**
 * Recursive walker that fixes up `link` marks. Tiptap may emit `href="#item-id"`
 * for cross-item references; Confluence's link mark requires fully-qualified
 * URLs or relative paths, so we either resolve the fragment via the callback
 * (pass 2) or drop the mark (pass 1).
 */
function postProcessLinks(nodes: AdfNode[], opts: RenderItemAdfOpts): AdfNode[] {
  return nodes.map((n) => walkNode(n, opts));
}

function walkNode(node: AdfNode, opts: RenderItemAdfOpts): AdfNode {
  let next = node;
  if (node.marks) {
    const remapped = node.marks
      .map((m) => mapLinkMark(m, opts))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (remapped.length) {
      next = { ...node, marks: remapped };
    } else {
      // Drop the marks key entirely when empty — ADF rejects nodes with
      // `marks: []`, and it makes the output easier to assert against.
      const { marks: _drop, ...rest } = node;
      next = rest;
    }
  }
  if (node.content) {
    next = { ...next, content: node.content.map((c) => walkNode(c, opts)) };
  }
  return next;
}

function mapLinkMark(
  mark: { type: string; attrs?: Record<string, unknown> },
  opts: RenderItemAdfOpts,
): { type: string; attrs?: Record<string, unknown> } | null {
  if (mark.type !== "link") return mark;
  const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
  if (!href.startsWith("#")) return mark;
  // Internal #fragment link.
  if (opts.stubLinks) return null;
  const id = href.slice(1);
  const resolved = opts.resolveItemUrl?.(id);
  if (!resolved) return null;
  return { type: "link", attrs: { href: resolved } };
}
