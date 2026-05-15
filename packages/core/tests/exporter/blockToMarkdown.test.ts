import { describe, expect, it } from "vitest";
import { blockToMarkdown } from "../../src/exporter/blockToMarkdown.js";
import type { Block } from "../../src/spec/types.js";

describe("blockToMarkdown", () => {
  it("renders richtext block via tiptap", () => {
    const block: Block = {
      id: "b1",
      type: "richtext",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
      }),
    };
    const out = blockToMarkdown(block);
    expect(out).toContain("Hello world");
  });

  it("renders table block with headers and rows", () => {
    const block: Block = {
      id: "b2",
      type: "table",
      table: {
        columns: ["Name", "Type"],
        rows: [
          ["foo", "string"],
          ["bar", "number"],
        ],
      },
    };
    const out = blockToMarkdown(block);
    expect(out).toContain("| Name | Type |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| foo | string |");
    expect(out).toContain("| bar | number |");
  });

  it("renders code block with language fence", () => {
    const block: Block = {
      id: "b3",
      type: "code",
      content: "const x = 1;\nconsole.log(x);",
      meta: { language: "typescript" },
    };
    const out = blockToMarkdown(block);
    expect(out).toContain("```typescript");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("```");
  });

  it("renders response block with HTTP status sections", () => {
    const block: Block = {
      id: "b4",
      type: "response",
      responses: [
        { status: 200, description: "OK", body: '{"id": 1}' },
        { status: 404, description: "Not Found", body: '{"error": "not found"}' },
      ],
    };
    const out = blockToMarkdown(block);
    expect(out).toContain("### HTTP 200 — OK");
    expect(out).toContain('{"id": 1}');
    expect(out).toContain("### HTTP 404 — Not Found");
  });

  it("renders callout block with NOTE prefix", () => {
    const block: Block = {
      id: "b5",
      type: "callout",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Be careful!" }] }],
      }),
      meta: { variant: "warning" },
    };
    const out = blockToMarkdown(block);
    expect(out).toContain("> [!WARNING]");
    expect(out).toContain("Be careful!");
  });

  it("renders image block as markdown image syntax", () => {
    const block: Block = {
      id: "b6",
      type: "image",
      meta: { src: "https://example.com/img.png", alt: "A diagram" },
    };
    const out = blockToMarkdown(block);
    expect(out).toContain("![A diagram](https://example.com/img.png)");
  });
});
