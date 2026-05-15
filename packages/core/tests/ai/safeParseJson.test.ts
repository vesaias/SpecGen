import { describe, expect, it } from "vitest";
import { safeParseJson } from "../../src/ai/safeParseJson.js";

describe("safeParseJson", () => {
  it("strategy 1: parses clean JSON directly", () => {
    const result = safeParseJson('{"description":"hello","techStack":["React"]}');
    expect(result).toEqual({ description: "hello", techStack: ["React"] });
  });

  it("strategy 1: parses a JSON array directly", () => {
    const result = safeParseJson('["a","b","c"]');
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("strategy 2: extracts JSON from the last ```json fence", () => {
    const text = `Here is some prose.\n\n\`\`\`json\n{"description":"first"}\n\`\`\`\n\nMore prose.\n\n\`\`\`json\n{"description":"last"}\n\`\`\``;
    const result = safeParseJson(text);
    // Should pick the LAST fenced block
    expect(result).toEqual({ description: "last" });
  });

  it("strategy 2: extracts JSON from a plain ``` fence (no json tag)", () => {
    const text = 'Some prose\n```\n{"key":"value"}\n```\n';
    const result = safeParseJson(text);
    expect(result).toEqual({ key: "value" });
  });

  it("strategy 3: extracts first balanced {...} block from freeform text", () => {
    const text = 'The answer is {"description":"extracted","areas":[]} per the analysis.';
    const result = safeParseJson(text);
    expect(result).toEqual({ description: "extracted", areas: [] });
  });

  it("strategy 3: handles braces inside string values without confusion", () => {
    const text = 'prefix {"key": "value with } brace"} suffix';
    const result = safeParseJson(text);
    expect(result).toEqual({ key: "value with } brace" });
  });

  it("returns null on completely invalid input", () => {
    expect(safeParseJson("not json at all")).toBeNull();
    expect(safeParseJson("")).toBeNull();
    expect(safeParseJson("   ")).toBeNull();
  });

  it("returns null when fences contain invalid JSON", () => {
    const text = "```json\nnot-valid-json\n```";
    expect(safeParseJson(text)).toBeNull();
  });
});
