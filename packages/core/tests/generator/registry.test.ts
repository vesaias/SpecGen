import { describe, expect, it } from "vitest";
import type { GeneratorPlugin } from "../../src/generator/Generator.js";
import { GeneratorRegistry } from "../../src/generator/GeneratorRegistry.js";

function fakePlugin(id: string): GeneratorPlugin {
  return {
    id,
    name: id,
    description: `Fake generator ${id}`,
    supports_profiles: "*",
    supports_parsers: "*",
    produces_item_types: ["backend"],
    async *run() {
      yield {
        type: "done" as const,
        stats: { itemsCreated: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: 0 },
      };
    },
  };
}

describe("GeneratorRegistry", () => {
  it("register + get + list", () => {
    const reg = new GeneratorRegistry();
    reg.register(fakePlugin("full-tree-spec"));
    reg.register(fakePlugin("single-page-spec"));
    expect(
      reg
        .list()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["full-tree-spec", "single-page-spec"]);
    expect(reg.get("full-tree-spec")?.id).toBe("full-tree-spec");
    expect(reg.get("missing")).toBeUndefined();
  });

  it("rejects duplicate ids", () => {
    const reg = new GeneratorRegistry();
    reg.register(fakePlugin("full-tree-spec"));
    expect(() => reg.register(fakePlugin("full-tree-spec"))).toThrow(/duplicate/);
  });

  it("fullTreeSpecGenerator registers cleanly", async () => {
    const { fullTreeSpecGenerator } = await import(
      "../../src/generator/builtins/full-tree-spec.js"
    );
    const reg = new GeneratorRegistry();
    expect(() => reg.register(fullTreeSpecGenerator)).not.toThrow();
    expect(reg.get("full-tree-spec")).toBe(fullTreeSpecGenerator);
  });
});
