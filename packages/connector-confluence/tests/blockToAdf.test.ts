import type { Block } from "@specgen/core";
import { describe, expect, it } from "vitest";
import { blockToAdf } from "../src/blockToAdf.js";

describe("blockToAdf", () => {
  it("returns AdfNode[] (not an AdfDoc) for splicing", () => {
    const result = blockToAdf({
      id: "b1",
      type: "code",
      content: "x",
      meta: { language: "ts" },
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]?.type).toBe("codeBlock");
  });

  it("richtext splices the parsed doc content", () => {
    const tiptap = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    });
    const result = blockToAdf({ id: "b1", type: "richtext", content: tiptap });
    expect(result).toEqual([{ type: "paragraph", content: [{ type: "text", text: "hi" }] }]);
  });

  it("richtext with invalid JSON falls back to a single paragraph", () => {
    const result = blockToAdf({
      id: "b1",
      type: "richtext",
      content: "not json",
    });
    expect(result[0]?.type).toBe("paragraph");
    expect(result[0]?.content?.[0]?.text).toBe("not json");
  });

  it("table emits one tableRow of headers + one tableRow per data row", () => {
    const block: Block = {
      id: "b1",
      type: "table",
      table: {
        columns: ["A", "B"],
        rows: [
          ["1", "2"],
          ["3", "4"],
        ],
      },
    };
    const result = blockToAdf(block);
    expect(result).toHaveLength(1);
    const table = result[0];
    expect(table?.type).toBe("table");
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(table?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
    expect(table?.content?.[0]?.content?.[0]?.attrs).toEqual({
      colspan: 1,
      rowspan: 1,
    });
  });

  it("table with no columns returns []", () => {
    expect(blockToAdf({ id: "b1", type: "table", table: { columns: [], rows: [] } })).toEqual([]);
  });

  it("code emits a codeBlock with language attr", () => {
    const result = blockToAdf({
      id: "b1",
      type: "code",
      content: "console.log(1)",
      meta: { language: "ts" },
    });
    expect(result).toEqual([
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: "console.log(1)" }],
      },
    ]);
  });

  it("response emits one expand per response with a json codeBlock body", () => {
    const block: Block = {
      id: "b1",
      type: "response",
      responses: [
        { status: 200, description: "ok", body: '{"a":1}' },
        { status: 404, description: "not found", body: '{"e":"x"}' },
      ],
    };
    const result = blockToAdf(block);
    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe("expand");
    expect(result[0]?.attrs).toEqual({ title: "200 — ok" });
    expect(result[0]?.content?.[0]?.type).toBe("codeBlock");
    expect(result[0]?.content?.[0]?.attrs).toEqual({ language: "json" });
    expect(result[0]?.content?.[0]?.content?.[0]?.text).toBe('{"a":1}');
  });

  it.each([
    ["info", "info"],
    ["warning", "warning"],
    ["tip", "success"],
    ["note", "note"],
    ["error", "error"],
  ])("callout variant %s → panelType %s", (variant, panelType) => {
    const tiptap = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }],
    });
    const result = blockToAdf({
      id: "b1",
      type: "callout",
      content: tiptap,
      meta: { variant },
    });
    expect(result).toEqual([
      {
        type: "panel",
        attrs: { panelType },
        content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }],
      },
    ]);
  });

  it("callout with missing variant defaults to note panel", () => {
    const tiptap = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    });
    const result = blockToAdf({ id: "b1", type: "callout", content: tiptap });
    expect(result[0]?.attrs).toEqual({ panelType: "note" });
  });

  it("callout with empty content still has at least one block child", () => {
    const result = blockToAdf({ id: "b1", type: "callout", content: "{}" });
    expect(result[0]?.content?.length).toBeGreaterThanOrEqual(1);
  });

  it("image emits a text placeholder paragraph", () => {
    const result = blockToAdf({
      id: "b1",
      type: "image",
      meta: { src: "https://example.com/x.png", alt: "x" },
    });
    expect(result).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "[Image: https://example.com/x.png]" }],
      },
    ]);
  });
});
