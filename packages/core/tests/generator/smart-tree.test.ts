import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { AiClient, AiCompletionInput, AiCompletionResult } from "../../src/ai/AiClient.js";
import { AiRouter } from "../../src/ai/AiRouter.js";
import { LocalClient } from "../../src/ai/providers/LocalClient.js";
import { smartTreeGenerator } from "../../src/generator/builtins/smart-tree.js";
import { ParserRegistry } from "../../src/parser/ParserRegistry.js";
import { ProfileLoader } from "../../src/profile/ProfileLoader.js";
import { JsonSpecRepository } from "../../src/spec/JsonSpecRepository.js";
import type { Spec } from "../../src/spec/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES = path.resolve(__dirname, "../../profiles");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Captured ai.complete inputs from the most recent fakeAi call (per test). */
const capturedInputs: AiCompletionInput[] = [];

/** AI mock that always returns the given text and records each input. */
function fakeAi(text: string): AiClient {
  return {
    provider: "local",
    models: [{ id: "stub", displayName: "stub" }],
    async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
      capturedInputs.push(input);
      return {
        text,
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
      };
    },
  };
}

/** Drain the generator and return all events */
async function runGenerator(ctx: Parameters<typeof smartTreeGenerator.run>[0]) {
  const events = [];
  for await (const e of smartTreeGenerator.run(ctx)) {
    events.push(e);
  }
  return events;
}

/** Build a spec with n backend items and a flat tree */
function makeSpec(ids: string[]): Spec {
  const items: Spec["items"] = {};
  for (const id of ids) {
    items[id] = { id, type: "backend", title: `Title ${id}`, summary: `Summary for ${id}` } as any;
  }
  return {
    meta: { target: "test", version: "v1", generatedAt: new Date().toISOString() },
    tree: ids.map((id) => ({ id, type: "backend" as const })),
    items,
  };
}

/** Write spec to disk and also write individual item files */
async function prepareSpec(repo: JsonSpecRepository, spec: Spec): Promise<void> {
  await repo.write(spec);
  for (const item of Object.values(spec.items)) {
    await repo.writeItem(item as any);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("smartTreeGenerator", () => {
  beforeEach(() => {
    capturedInputs.length = 0;
  });

  it("happy path: AI returns valid tree → tree written, stats.itemsUpdated=1", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-smart-tree-"));
    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const repo = new JsonSpecRepository(dir);
    const ids = ["a", "b", "c", "d", "e"];
    await prepareSpec(repo, makeSpec(ids));

    const treeJson = JSON.stringify({
      tree: [
        {
          id: "folder-auth",
          type: "folder",
          label: "Auth",
          children: [
            { id: "a", type: "backend" },
            { id: "b", type: "backend" },
          ],
        },
        {
          id: "folder-data",
          type: "folder",
          label: "Data",
          children: [
            { id: "c", type: "backend" },
            { id: "d", type: "backend" },
            { id: "e", type: "backend" },
          ],
        },
      ],
    });

    const ai = new AiRouter({ primary: fakeAi(treeJson) });
    const events = await runGenerator({
      rootDir: dir,
      profile,
      parsers: new ParserRegistry(),
      spec: repo,
      ai,
    });

    // Guard against RenderedPrompt-as-object regressions
    expect(typeof capturedInputs[0]?.prompt).toBe("string");
    expect((capturedInputs[0]?.prompt ?? "").length).toBeGreaterThan(0);

    // Should have progress events
    expect(events.some((e) => e.type === "progress")).toBe(true);

    // Should have item-updated __tree__
    expect(
      events.some(
        (e) => e.type === "item-updated" && (e as { itemId: string }).itemId === "__tree__",
      ),
    ).toBe(true);

    // Last event: done
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    const stats = (done as any).stats;
    expect(stats.itemsUpdated).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(stats.aiCalls).toHaveLength(1);
    expect(stats.aiCalls[0].status).toBe("ok");
    expect(stats.aiCalls[0].itemId).toBe("__tree__");

    // New tree should be written to spec. `enforceKindSplit` wraps the AI's
    // feature folders inside a top-level Backend bucket (all items are backend
    // here). Folder ids get a `-backend` suffix to stay unique across buckets;
    // labels are preserved.
    const written = await repo.read();
    expect(written?.tree).toHaveLength(1);
    expect(written?.tree[0]).toMatchObject({ id: "backend", type: "folder", label: "Backend" });
    const backendChildren = written?.tree[0]?.children ?? [];
    expect(backendChildren).toHaveLength(2);
    expect(backendChildren[0]).toMatchObject({ id: "folder-auth-backend", label: "Auth" });
    expect(backendChildren[1]).toMatchObject({ id: "folder-data-backend", label: "Data" });

    // Items must still exist unchanged
    for (const id of ids) {
      const item = await repo.readItem(id);
      expect(item).not.toBeNull();
    }
  });

  it("AI returns missing items → validation rejects, tree unchanged, warning, status=schema_invalid", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-smart-tree-"));
    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const repo = new JsonSpecRepository(dir);
    const originalSpec = makeSpec(["a", "b", "c", "d", "e"]);
    await prepareSpec(repo, originalSpec);

    // AI omits "e" from the output
    const treeJson = JSON.stringify({
      tree: [
        {
          id: "folder-x",
          type: "folder",
          label: "X",
          children: [
            { id: "a", type: "backend" },
            { id: "b", type: "backend" },
            { id: "c", type: "backend" },
            { id: "d", type: "backend" },
            // "e" missing
          ],
        },
      ],
    });

    const ai = new AiRouter({ primary: fakeAi(treeJson) });
    const events = await runGenerator({
      rootDir: dir,
      profile,
      parsers: new ParserRegistry(),
      spec: repo,
      ai,
    });

    expect(events.some((e) => e.type === "warning")).toBe(true);
    const warning = events.find((e) => e.type === "warning") as any;
    expect(warning.message).toContain("missing");
    expect(warning.message).toContain("tree unchanged");

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    const stats = (done as any).stats;
    expect(stats.itemsUpdated).toBe(0);
    expect(stats.warnings).toBe(1);
    expect(stats.aiCalls[0].status).toBe("schema_invalid");

    // Tree must remain the original flat list
    const written = await repo.read();
    expect(written?.tree).toHaveLength(5); // flat: a b c d e
  });

  it("AI returns duplicate items → validation rejects, tree unchanged", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-smart-tree-"));
    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const repo = new JsonSpecRepository(dir);
    await prepareSpec(repo, makeSpec(["a", "b", "c", "d", "e"]));

    // AI duplicates "a"
    const treeJson = JSON.stringify({
      tree: [
        {
          id: "folder-x",
          type: "folder",
          label: "X",
          children: [
            { id: "a", type: "backend" },
            { id: "a", type: "backend" }, // duplicate
            { id: "b", type: "backend" },
            { id: "c", type: "backend" },
            { id: "d", type: "backend" },
            { id: "e", type: "backend" },
          ],
        },
      ],
    });

    const ai = new AiRouter({ primary: fakeAi(treeJson) });
    const events = await runGenerator({
      rootDir: dir,
      profile,
      parsers: new ParserRegistry(),
      spec: repo,
      ai,
    });

    expect(events.some((e) => e.type === "warning")).toBe(true);
    const warning = events.find((e) => e.type === "warning") as any;
    expect(warning.message).toContain("duplicate");

    const done = events.at(-1);
    expect((done as any).stats.aiCalls[0].status).toBe("schema_invalid");
  });

  it("AI returns extra unknown items → validation rejects, tree unchanged", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-smart-tree-"));
    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const repo = new JsonSpecRepository(dir);
    await prepareSpec(repo, makeSpec(["a", "b", "c", "d", "e"]));

    // AI invents "z-invented" which isn't in the input
    const treeJson = JSON.stringify({
      tree: [
        {
          id: "folder-x",
          type: "folder",
          label: "X",
          children: [
            { id: "a", type: "backend" },
            { id: "b", type: "backend" },
            { id: "c", type: "backend" },
            { id: "d", type: "backend" },
            { id: "e", type: "backend" },
            { id: "z-invented", type: "backend" }, // unknown
          ],
        },
      ],
    });

    const ai = new AiRouter({ primary: fakeAi(treeJson) });
    const events = await runGenerator({
      rootDir: dir,
      profile,
      parsers: new ParserRegistry(),
      spec: repo,
      ai,
    });

    expect(events.some((e) => e.type === "warning")).toBe(true);
    const warning = events.find((e) => e.type === "warning") as any;
    expect(warning.message).toContain("unknown");
    expect((events.at(-1) as any).stats.aiCalls[0].status).toBe("schema_invalid");
  });

  it("AI returns malformed JSON → warning, status=json_parse_failed, tree unchanged", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-smart-tree-"));
    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const repo = new JsonSpecRepository(dir);
    await prepareSpec(repo, makeSpec(["a", "b", "c", "d", "e"]));

    const ai = new AiRouter({ primary: fakeAi("Here is the tree: (not valid json at all)") });
    const events = await runGenerator({
      rootDir: dir,
      profile,
      parsers: new ParserRegistry(),
      spec: repo,
      ai,
    });

    expect(events.some((e) => e.type === "warning")).toBe(true);
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    const stats = (done as any).stats;
    expect(stats.aiCalls[0].status).toBe("json_parse_failed");
    expect(stats.itemsUpdated).toBe(0);
  });

  it("no existing spec → error event + done with 0 stats", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-smart-tree-"));
    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const repo = new JsonSpecRepository(dir);

    const ai = new AiRouter({ primary: new LocalClient() });
    const events = await runGenerator({
      rootDir: dir,
      profile,
      parsers: new ParserRegistry(),
      spec: repo,
      ai,
    });

    expect(events.some((e) => e.type === "error")).toBe(true);
    const errorEvent = events.find((e) => e.type === "error") as any;
    expect(errorEvent.error.message).toContain("full-tree-spec");

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    const stats = (done as any).stats;
    expect(stats.itemsCreated).toBe(0);
    expect(stats.itemsUpdated).toBe(0);
    expect(stats.aiCalls).toHaveLength(0);
  });

  it("fewer than 3 items → warning + done, no AI call made", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-smart-tree-"));
    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const repo = new JsonSpecRepository(dir);

    // Only 2 items
    await prepareSpec(repo, makeSpec(["a", "b"]));

    // AI should NOT be called — we use a client that throws if invoked
    const throwingAi: AiClient = {
      provider: "local",
      models: [{ id: "stub", displayName: "stub" }],
      async complete() {
        throw new Error("AI should not have been called with fewer than 3 items");
      },
    };
    const ai = new AiRouter({ primary: throwingAi });

    const events = await runGenerator({
      rootDir: dir,
      profile,
      parsers: new ParserRegistry(),
      spec: repo,
      ai,
    });

    expect(events.some((e) => e.type === "warning")).toBe(true);
    const warning = events.find((e) => e.type === "warning") as any;
    expect(warning.message).toContain("too few");

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    const stats = (done as any).stats;
    expect(stats.aiCalls).toHaveLength(0);
    expect(stats.itemsUpdated).toBe(0);
  });
});
