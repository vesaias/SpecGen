import { describe, expect, it } from "vitest";
import { LocalFs } from "../../src/parser/LocalFs.js";
import type { ParserPlugin } from "../../src/parser/Parser.js";
import { ParserRegistry } from "../../src/parser/ParserRegistry.js";

const fakePlugin = (id: string, confidence = 0.8): ParserPlugin => ({
  id,
  name: id,
  async detect() {
    return { confidence, subDirs: [] };
  },
  async parse() {
    return { warnings: [] };
  },
});

describe("ParserRegistry", () => {
  it("register + get + list", () => {
    const reg = new ParserRegistry();
    reg.register(fakePlugin("dotnet"));
    reg.register(fakePlugin("react"));
    expect(
      reg
        .list()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["dotnet", "react"]);
    expect(reg.get("dotnet")?.id).toBe("dotnet");
    expect(reg.get("missing")).toBeUndefined();
  });

  it("rejects duplicate ids", () => {
    const reg = new ParserRegistry();
    reg.register(fakePlugin("dotnet"));
    expect(() => reg.register(fakePlugin("dotnet"))).toThrow(/duplicate/);
  });

  it("detectAll returns sorted-by-confidence results, drops zero-confidence", async () => {
    const reg = new ParserRegistry();
    reg.register(fakePlugin("low", 0.3));
    reg.register(fakePlugin("high", 0.9));
    reg.register(fakePlugin("zero", 0));
    const r = await reg.detectAll("/tmp", new LocalFs("/tmp"));
    expect(r.map((x) => x.plugin.id)).toEqual(["high", "low"]);
  });
});
