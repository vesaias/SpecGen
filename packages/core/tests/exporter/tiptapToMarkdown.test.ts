import { describe, expect, it } from "vitest";
import { tiptapToMarkdown } from "../../src/exporter/tiptapToMarkdown.js";

describe("tiptapToMarkdown", () => {
  it("renders headings (h1-h6)", () => {
    const out = tiptapToMarkdown({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "A" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "B" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "C" }] },
      ],
    });
    expect(out).toContain("# A");
    expect(out).toContain("## B");
    expect(out).toContain("### C");
  });

  it("renders paragraphs with bold/italic/code/link marks", () => {
    const out = tiptapToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "x" },
            { type: "text", text: " " },
            { type: "text", marks: [{ type: "italic" }], text: "y" },
            { type: "text", text: " " },
            { type: "text", marks: [{ type: "code" }], text: "z" },
            { type: "text", text: " " },
            {
              type: "text",
              marks: [{ type: "link", attrs: { href: "https://x" } }],
              text: "L",
            },
          ],
        },
      ],
    });
    expect(out.trim()).toBe("**x** *y* `z` [L](https://x)");
  });

  it("renders bullet and ordered lists", () => {
    const ul = tiptapToMarkdown({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }],
            },
          ],
        },
      ],
    });
    expect(ul).toContain("- a\n- b\n");

    const ol = tiptapToMarkdown({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
            },
          ],
        },
      ],
    });
    expect(ol).toContain("1. a\n");
  });

  it("renders details as collapsible HTML", () => {
    const out = tiptapToMarkdown({
      type: "doc",
      content: [
        {
          type: "details",
          content: [
            {
              type: "detailsSummary",
              content: [{ type: "text", text: "Summary" }],
            },
            {
              type: "detailsContent",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
            },
          ],
        },
      ],
    });
    expect(out).toContain("<details>");
    expect(out).toContain("<summary>Summary</summary>");
    expect(out).toContain("Body");
    expect(out).toContain("</details>");
  });

  it("renders blockquote with > prefix on each line", () => {
    const out = tiptapToMarkdown({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "line one" }] }],
        },
      ],
    });
    expect(out).toContain("> line one");
  });

  it("returns empty string for null / undefined doc", () => {
    expect(tiptapToMarkdown(null)).toBe("");
    expect(tiptapToMarkdown(undefined)).toBe("");
  });

  it("applies link mark outermost regardless of mark array order", () => {
    // bold first then link → link must end up outermost
    const out = tiptapToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://x" } }],
              text: "X",
            },
          ],
        },
      ],
    });
    expect(out.trim()).toBe("[**X**](https://x)");
  });

  it("escapes code fence when content contains triple backticks", () => {
    const out = tiptapToMarkdown({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "md" },
          content: [{ type: "text", text: "```\nnested\n```" }],
        },
      ],
    });
    // The fence must be longer than any backtick run inside
    expect(out).toMatch(/^````md\n[\s\S]*\n````\n/);
  });
});
