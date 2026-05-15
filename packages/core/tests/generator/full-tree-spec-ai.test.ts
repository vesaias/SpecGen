import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AiClient, AiCompletionInput, AiCompletionResult } from "../../src/ai/AiClient.js";
import { AiRouter } from "../../src/ai/AiRouter.js";
import { LocalClient } from "../../src/ai/providers/LocalClient.js";
import { fullTreeSpecGenerator } from "../../src/generator/builtins/full-tree-spec.js";
import type { ParserPlugin } from "../../src/parser/Parser.js";
import { ParserRegistry } from "../../src/parser/ParserRegistry.js";
import { ProfileLoader } from "../../src/profile/ProfileLoader.js";
import { JsonSpecRepository } from "../../src/spec/JsonSpecRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES = path.resolve(__dirname, "../../profiles");

const fakeParser: ParserPlugin = {
  id: "fake",
  name: "Fake",
  async detect() {
    return { confidence: 1, subDirs: [] };
  },
  async parse() {
    return {
      endpoints: [
        {
          id: "get-x",
          title: "GET /x",
          route: "/x",
          method: "GET",
          summary: "[TODO]",
          context: "[TODO]",
          controller: "XController",
          parameters: [],
          responses: [],
          validationRules: [],
          orchestration: [],
          dependencies: [],
          sourceFiles: [],
        } as any,
      ],
      warnings: [],
    };
  },
};

async function runWith(ai: AiRouter, dataDir: string, options?: Record<string, unknown>) {
  const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
  const parsers = new ParserRegistry();
  parsers.register(fakeParser);
  const spec = new JsonSpecRepository(dataDir);
  const events: Array<{ type: string; payload?: unknown }> = [];
  for await (const e of fullTreeSpecGenerator.run({
    rootDir: "/tmp",
    profile,
    parsers,
    spec,
    ai,
    options,
  })) {
    events.push({ type: e.type, payload: e });
  }
  return { events, spec };
}

describe("full-tree-spec with AI router", () => {
  it("emits a warning when AI output is not valid JSON; item keeps [TODO]", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-ai-bad-"));
    const ai = new AiRouter({ primary: new LocalClient() }); // returns non-JSON text
    const { events, spec } = await runWith(ai, dir);

    expect(events.some((e) => e.type === "warning")).toBe(true);
    const item = await spec.readItem("get-x");
    expect(item?.summary).toBe("[TODO]");
  });

  it("done event reports aiCalls + aiCostUsdTotal", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-ai-stats-"));
    const ai = new AiRouter({ primary: new LocalClient() });
    const { events } = await runWith(ai, dir);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    const stats = (done?.payload as { stats: { aiCalls: unknown[]; aiCostUsdTotal: number } })
      .stats;
    expect(Array.isArray(stats.aiCalls)).toBe(true);
    expect(stats.aiCalls.length).toBeGreaterThan(0);
    // LocalClient → 'local' provider → not in PRICING → cost is 0
    expect(stats.aiCostUsdTotal).toBe(0);
  });

  it("merges AI output into item when JSON validates", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-ai-good-"));
    // A canned client that returns JSON matching backendEnrichmentSchema
    const cannedClient: AiClient = {
      provider: "local",
      models: [{ id: "stub", displayName: "stub" }],
      complete: async (_input: AiCompletionInput): Promise<AiCompletionResult> => ({
        text: JSON.stringify({
          summary: "Returns the X resource by id.",
          context: "Used by the X dashboard.",
        }),
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
      }),
    };
    const ai = new AiRouter({ primary: cannedClient });
    const { spec } = await runWith(ai, dir);
    const item = await spec.readItem("get-x");
    expect(item?.summary).toBe("Returns the X resource by id.");
    expect(item?.context).toBe("Used by the X dashboard.");
  });

  it("strips ```json fences from AI output before parsing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-ai-fenced-"));
    const cannedClient: AiClient = {
      provider: "local",
      models: [{ id: "stub", displayName: "stub" }],
      complete: async (_input: AiCompletionInput): Promise<AiCompletionResult> => ({
        text: '```json\n{"summary":"x","context":"y"}\n```',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
      }),
    };
    const ai = new AiRouter({ primary: cannedClient });
    const { spec } = await runWith(ai, dir);
    const item = await spec.readItem("get-x");
    expect(item?.summary).toBe("x");
  });

  it("force=true re-enriches items with no TODO and matching enrichedSourceHash", async () => {
    // First pass: enrich the item to populate summary/context + enrichedSourceHash
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-ai-force-"));
    let callCount = 0;
    const cannedClient: AiClient = {
      provider: "local",
      models: [{ id: "stub", displayName: "stub" }],
      complete: async (_input: AiCompletionInput): Promise<AiCompletionResult> => {
        callCount++;
        return {
          text: JSON.stringify({
            summary: callCount === 1 ? "first" : "rebuilt",
            context: callCount === 1 ? "ctx-1" : "ctx-rebuilt",
          }),
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
        };
      },
    };
    const ai = new AiRouter({ primary: cannedClient });

    // Pass 1 — populates real values + enrichedSourceHash. Initial mode picks
    // up the item because it has [TODO] sentinels.
    await runWith(ai, dir);
    const afterFirst = await new JsonSpecRepository(dir).readItem("get-x");
    expect(afterFirst?.summary).toBe("first");
    // enrichedSourceHash should now match sourceHash → drift gate would skip.
    expect((afterFirst as any)?.enrichedSourceHash).toBe((afterFirst as any)?.sourceHash);

    // Pass 2 — change-detect mode with no drift, no TODO. Without force this
    // would be a no-op. With force=true, the AI is invoked again.
    await runWith(ai, dir, { mode: "change-detect", force: true });
    const afterForce = await new JsonSpecRepository(dir).readItem("get-x");
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(afterForce?.summary).toBe("rebuilt");
    expect(afterForce?.context).toBe("ctx-rebuilt");
  });

  it("provider_error status logged when AI throws", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-ai-err-"));
    const erroringClient: AiClient = {
      provider: "local",
      models: [{ id: "stub", displayName: "stub" }],
      complete: async (_input: AiCompletionInput): Promise<AiCompletionResult> => {
        throw new Error("simulated outage");
      },
    };
    const ai = new AiRouter({
      primary: erroringClient,
      sleepMs: async () => undefined,
    });
    const { events } = await runWith(ai, dir);
    const done = events.find((e) => e.type === "done");
    const stats = (
      done?.payload as {
        stats: { aiCalls: Array<{ status: string; error?: string }> };
      }
    ).stats;
    expect(stats.aiCalls[0].status).toBe("provider_error");
    expect(stats.aiCalls[0].error).toContain("simulated outage");
  });
});
