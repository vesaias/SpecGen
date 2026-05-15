import { describe, expect, it } from "vitest";
import { tiptapToAdf } from "../src/tiptapToAdf.js";

describe("tiptapToAdf", () => {
  it("returns an empty doc for null input", () => {
    expect(tiptapToAdf(null)).toEqual({ version: 1, type: "doc", content: [] });
  });

  it("wraps content in a versioned doc envelope", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    });
    expect(result.version).toBe(1);
    expect(result.type).toBe("doc");
    expect(result.content[0]?.type).toBe("paragraph");
  });

  it("preserves paragraphs and text", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    });
    expect(result.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Hello" }],
    });
  });

  it("emits heading nodes with the level attr clamped to 1..6", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 9 },
          content: [{ type: "text", text: "Big" }],
        },
        {
          type: "heading",
          attrs: { level: -1 },
          content: [{ type: "text", text: "Tiny" }],
        },
      ],
    });
    expect(result.content[0]?.attrs?.level).toBe(6);
    expect(result.content[1]?.attrs?.level).toBe(1);
  });

  it("maps bold→strong, italic→em, code→code marks", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "b",
              marks: [{ type: "bold" }, { type: "italic" }, { type: "code" }],
            },
          ],
        },
      ],
    });
    const text = result.content[0]?.content?.[0];
    expect(text?.marks).toEqual([{ type: "strong" }, { type: "em" }, { type: "code" }]);
  });

  it("preserves link marks with href attr", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "https://x.com" } }],
            },
          ],
        },
      ],
    });
    const text = result.content[0]?.content?.[0];
    expect(text?.marks).toEqual([{ type: "link", attrs: { href: "https://x.com" } }]);
  });

  it("renders bulletList/orderedList/listItem", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "one" }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.content[0]?.type).toBe("orderedList");
    expect(result.content[0]?.attrs).toEqual({ order: 1 });
    expect(result.content[0]?.content?.[0]?.type).toBe("listItem");
  });

  it("renders horizontalRule as ADF `rule`", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [{ type: "horizontalRule" }],
    });
    expect(result.content[0]).toEqual({ type: "rule" });
  });

  it("renders hardBreak as ADF `hardBreak`", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "hardBreak" },
            { type: "text", text: "b" },
          ],
        },
      ],
    });
    expect(result.content[0]?.content?.[1]?.type).toBe("hardBreak");
  });

  it("renders codeBlock with language attr", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    });
    expect(result.content[0]).toEqual({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
  });

  it("renders details as expand with flattened summary title", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "details",
          content: [
            {
              type: "detailsSummary",
              content: [{ type: "text", text: "Click me" }],
            },
            {
              type: "detailsContent",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "secret" }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.content[0]?.type).toBe("expand");
    expect(result.content[0]?.attrs).toEqual({ title: "Click me" });
    expect(result.content[0]?.content?.[0]?.type).toBe("paragraph");
  });

  it("renders table/tableRow/tableHeader/tableCell with colspan/rowspan attrs", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "h" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "c" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const row = result.content[0]?.content?.[0];
    expect(row?.type).toBe("tableRow");
    expect(row?.content?.[0]?.type).toBe("tableHeader");
    expect(row?.content?.[0]?.attrs).toEqual({ colspan: 1, rowspan: 1 });
    expect(row?.content?.[1]?.type).toBe("tableCell");
    expect(row?.content?.[1]?.attrs).toEqual({ colspan: 1, rowspan: 1 });
  });

  it("renders blockquote", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }],
        },
      ],
    });
    expect(result.content[0]?.type).toBe("blockquote");
    expect(result.content[0]?.content?.[0]?.type).toBe("paragraph");
  });

  it("strips empty marks array (only sets marks if non-empty)", () => {
    const result = tiptapToAdf({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: [] }],
        },
      ],
    });
    const text = result.content[0]?.content?.[0];
    expect(text?.marks).toBeUndefined();
  });
});
