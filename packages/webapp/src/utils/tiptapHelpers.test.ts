import { describe, expect, it } from "vitest";
import { parseLightMarkdown, unwrapPlainText, wrapHeading, wrapPlainText } from "./tiptapHelpers";

// Convenience: parse the JSON returned by wrapPlainText.
function doc(s: string) {
  return JSON.parse(s);
}

describe("wrapPlainText — base cases", () => {
  it("returns empty string for empty input", () => {
    expect(wrapPlainText("")).toBe("");
  });

  it("passes through pre-existing Tiptap JSON", () => {
    const json = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    });
    expect(wrapPlainText(json)).toBe(json);
  });

  it("wraps a single plain line as one paragraph", () => {
    const d = doc(wrapPlainText("hello world"));
    expect(d).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hello world" }],
        },
      ],
    });
  });
});

describe("wrapPlainText — paragraph & hardBreak", () => {
  it("splits on blank line into multiple paragraphs", () => {
    const d = doc(wrapPlainText("first paragraph\n\nsecond paragraph"));
    expect(d.content).toHaveLength(2);
    expect(d.content[0].type).toBe("paragraph");
    expect(d.content[1].type).toBe("paragraph");
    expect(d.content[0].content[0].text).toBe("first paragraph");
    expect(d.content[1].content[0].text).toBe("second paragraph");
  });

  it("uses hardBreak for a single \\n between paragraph lines", () => {
    const d = doc(wrapPlainText("line one\nline two"));
    expect(d.content).toHaveLength(1);
    expect(d.content[0].type).toBe("paragraph");
    const c = d.content[0].content;
    expect(c[0]).toEqual({ type: "text", text: "line one" });
    expect(c[1]).toEqual({ type: "hardBreak" });
    expect(c[2]).toEqual({ type: "text", text: "line two" });
  });
});

describe("wrapPlainText — lists", () => {
  it("parses (a) (b) (c) sub-items as a bulletList after a paragraph", () => {
    const input =
      "Run all validation rules against the request body.\n(a) FirstName must be 2-50 characters.\n(b) Email must be a valid email format.\n(c) Phone must match the international format.";
    const d = doc(wrapPlainText(input));
    expect(d.content).toHaveLength(2);
    expect(d.content[0].type).toBe("paragraph");
    expect(d.content[0].content[0].text).toBe("Run all validation rules against the request body.");
    expect(d.content[1].type).toBe("bulletList");
    expect(d.content[1].content).toHaveLength(3);
    expect(d.content[1].content[0].content[0].content[0].text).toBe(
      "FirstName must be 2-50 characters.",
    );
    expect(d.content[1].content[1].content[0].content[0].text).toBe(
      "Email must be a valid email format.",
    );
  });

  it("parses (i) (ii) (iii) roman sub-items as a bulletList", () => {
    const d = doc(wrapPlainText("Top.\n(i) one\n(ii) two\n(iii) three"));
    expect(d.content[1].type).toBe("bulletList");
    expect(d.content[1].content).toHaveLength(3);
  });

  it("parses - / * as bulletList items", () => {
    const d = doc(wrapPlainText("Title.\n- alpha\n* beta\n- gamma"));
    expect(d.content[1].type).toBe("bulletList");
    expect(d.content[1].content).toHaveLength(3);
  });

  it("parses 1. 2. 3. as orderedList items", () => {
    const d = doc(wrapPlainText("Title.\n1. first\n2. second\n3. third"));
    expect(d.content[1].type).toBe("orderedList");
    expect(d.content[1].content).toHaveLength(3);
  });

  it("parses headings", () => {
    const d = doc(wrapPlainText("# H1\n## H2\n### H3"));
    expect(d.content).toHaveLength(3);
    expect(d.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(d.content[1]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(d.content[2]).toMatchObject({ type: "heading", attrs: { level: 3 } });
  });
});

describe("wrapPlainText — inline marks", () => {
  it("parses **bold**", () => {
    const d = doc(wrapPlainText("Hello **world** today"));
    const c = d.content[0].content;
    expect(c[0]).toEqual({ type: "text", text: "Hello " });
    expect(c[1]).toEqual({
      type: "text",
      text: "world",
      marks: [{ type: "bold" }],
    });
    expect(c[2]).toEqual({ type: "text", text: " today" });
  });

  it("parses *italic*", () => {
    const d = doc(wrapPlainText("a *b* c"));
    const c = d.content[0].content;
    expect(c[1]).toEqual({
      type: "text",
      text: "b",
      marks: [{ type: "italic" }],
    });
  });

  it("parses `code`", () => {
    const d = doc(wrapPlainText("call `fn()` here"));
    const c = d.content[0].content;
    expect(c[1]).toEqual({
      type: "text",
      text: "fn()",
      marks: [{ type: "code" }],
    });
  });

  it("does not treat list-marker `* ` as italic", () => {
    const d = doc(wrapPlainText("- one\n* two"));
    expect(d.content[0].type).toBe("bulletList");
    expect(d.content[0].content[1].content[0].content[0].text).toBe("two");
  });

  it("leaves an unterminated ** as literal text", () => {
    const d = doc(wrapPlainText("hello **world"));
    expect(d.content[0].content[0].text).toBe("hello **world");
  });
});

describe("wrapHeading", () => {
  it("wraps text as a heading at the given level", () => {
    const d = doc(wrapHeading("Title", 3));
    expect(d.content[0]).toEqual({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Title" }],
    });
  });

  it("returns empty string for empty input", () => {
    expect(wrapHeading("")).toBe("");
  });
});

describe("unwrapPlainText", () => {
  it("returns empty string for empty input", () => {
    expect(unwrapPlainText("")).toBe("");
  });

  it("joins paragraphs with double newline", () => {
    const d = wrapPlainText("p one\n\np two");
    expect(unwrapPlainText(d)).toBe("p one\n\np two");
  });

  it("preserves bold mark on roundtrip", () => {
    const d = wrapPlainText("Hello **world**!");
    expect(unwrapPlainText(d)).toBe("Hello **world**!");
  });

  it("renders bulletList back as (a) (b) (c)", () => {
    const d = wrapPlainText("Top.\n- one\n- two\n- three");
    expect(unwrapPlainText(d)).toBe("Top.\n\n(a) one\n(b) two\n(c) three");
  });

  it("renders orderedList back as 1. 2. 3.", () => {
    const d = wrapPlainText("Top.\n1. one\n2. two\n3. three");
    expect(unwrapPlainText(d)).toBe("Top.\n\n1. one\n2. two\n3. three");
  });

  it("renders heading back with # prefix", () => {
    const d = wrapPlainText("## My heading");
    expect(unwrapPlainText(d)).toBe("## My heading");
  });

  it("falls back to raw input on invalid JSON", () => {
    expect(unwrapPlainText("not json")).toBe("not json");
  });
});

describe("round-trip", () => {
  it("wrap(unwrap(wrap(x))) === wrap(x) for representative inputs", () => {
    const inputs = [
      "Run all validation rules.\n(a) one\n(b) two **bold**\n(c) three",
      "first paragraph\n\nsecond paragraph",
      "Top.\n1. first **bold**\n2. second *italic*\n3. third `code`",
      "# Heading 1\n\nbody text with **bold** and *italic*",
      "single line",
    ];
    for (const input of inputs) {
      const a = wrapPlainText(input);
      const b = wrapPlainText(unwrapPlainText(a));
      expect(b).toBe(a);
    }
  });
});

describe("parseLightMarkdown — details merge", () => {
  it("merges 'Summary —' paragraph + fenced code block into a details node", () => {
    const input = [
      "Summary — Response — GET /api/foo",
      "```json",
      '{ "id": 7, "name": "alice" }',
      "```",
    ].join("\n");
    const blocks = parseLightMarkdown(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("details");
    if (blocks[0].type === "details") {
      expect(blocks[0].content[0].type).toBe("detailsSummary");
      expect(blocks[0].content[0].content[0]).toEqual({
        type: "text",
        text: "Response — GET /api/foo",
      });
      expect(blocks[0].content[1].type).toBe("detailsContent");
      const body = blocks[0].content[1].content[0];
      expect(body.type).toBe("codeBlock");
      if (body.type === "codeBlock") {
        expect(body.attrs?.language).toBe("json");
        expect(body.content[0].text).toBe('{ "id": 7, "name": "alice" }');
      }
    }
  });

  it("merges with 'Details:' prefix and brace-wrapped language tag", () => {
    const input = ["Details: payload", "```{json}", "{}", "```"].join("\n");
    const blocks = parseLightMarkdown(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("details");
    if (blocks[0].type === "details") {
      expect(blocks[0].content[0].content[0]).toEqual({ type: "text", text: "payload" });
      const body = blocks[0].content[1].content[0];
      if (body.type === "codeBlock") expect(body.attrs?.language).toBe("json");
    }
  });

  it("leaves 'Summary —' as plain paragraph when no code block follows", () => {
    const input = "Summary — just text\n\nnext paragraph";
    const blocks = parseLightMarkdown(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[1].type).toBe("paragraph");
  });

  it("does not break paragraph parsing around a stray code block", () => {
    const input = ["intro paragraph", "", "```", "code body", "```", "", "outro"].join("\n");
    const blocks = parseLightMarkdown(input);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[1].type).toBe("codeBlock");
    expect(blocks[2].type).toBe("paragraph");
  });
});

describe("parseLightMarkdown — orchestration rollup shape", () => {
  it("handles the failing real-world example from BackendPage", () => {
    const orchText = [
      "1. `validateRequest` — Run all validation rules against the request body.",
      "(a) FirstName must be 2-50 characters.",
      "(b) **Email** must be a valid email format. Query the Customers table.",
      "(c) Phone must match the international format.",
      "2. `persistCustomer` — Save the new customer record.",
    ].join("\n");
    const blocks = parseLightMarkdown(orchText);
    // Expected: orderedList(1.) -> bulletList((a)(b)(c)) -> orderedList(2.)
    const types = blocks.map((b) => b.type);
    expect(types).toEqual(["orderedList", "bulletList", "orderedList"]);
    expect(blocks[1].type).toBe("bulletList");
    if (blocks[1].type === "bulletList") {
      expect(blocks[1].content).toHaveLength(3);
      // (b) line should contain a bold mark on "Email".
      const bLine = blocks[1].content[1];
      const para = bLine.content[0];
      const boldNode = para.content.find(
        (n) => "marks" in n && n.marks?.some((m) => m.type === "bold"),
      );
      expect(boldNode).toBeDefined();
      if (boldNode && "text" in boldNode) expect(boldNode.text).toBe("Email");
    }
  });
});
