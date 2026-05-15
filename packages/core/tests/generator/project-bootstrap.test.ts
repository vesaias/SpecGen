import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { AiClient, AiCompletionInput, AiCompletionResult } from "../../src/ai/AiClient.js";
import { AiRouter } from "../../src/ai/AiRouter.js";
import { LocalClient } from "../../src/ai/providers/LocalClient.js";
import { projectBootstrapGenerator } from "../../src/generator/builtins/project-bootstrap.js";
import { LocalFs } from "../../src/parser/LocalFs.js";
import { ParserRegistry } from "../../src/parser/ParserRegistry.js";
import { ProfileLoader } from "../../src/profile/ProfileLoader.js";
import { JsonSpecRepository } from "../../src/spec/JsonSpecRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES = path.resolve(__dirname, "../../profiles");

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
          output_tokens: 150,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
      };
    },
  };
}

/** Drain the generator and return all events */
async function runGenerator(ctx: Parameters<typeof projectBootstrapGenerator.run>[0]) {
  const events = [];
  for await (const e of projectBootstrapGenerator.run(ctx)) {
    events.push(e);
  }
  return events;
}

describe("projectBootstrapGenerator", () => {
  beforeEach(() => {
    capturedInputs.length = 0;
  });

  it("happy path: populates spec.meta.bootstrap from AI JSON", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-bootstrap-"));
    const sourceDir = mkdtempSync(path.join(tmpdir(), "specgen-bootstrap-src-"));

    // Create fixture source files
    writeFileSync(
      path.join(sourceDir, "README.md"),
      "# MyApp\nA demo application for testing purposes.",
    );
    writeFileSync(
      path.join(sourceDir, "package.json"),
      JSON.stringify({ name: "my-app", version: "1.0.0", dependencies: { react: "^18" } }),
    );

    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const bootstrapJson = JSON.stringify({
      description: "A demo app for testing. It has a React frontend.",
      primaryAudience: "developers",
      suggestedProfile: "pm-spec",
      techStack: ["React", "Node.js"],
      areas: [{ name: "Frontend", subdir: "src", description: "React UI" }],
    });
    const ai = new AiRouter({ primary: fakeAi(bootstrapJson) });
    const spec = new JsonSpecRepository(dir);
    const fs = new LocalFs(sourceDir);

    const events = await runGenerator({
      rootDir: sourceDir,
      profile,
      parsers: new ParserRegistry(),
      spec,
      ai,
      fs,
    });

    // Guard against RenderedPrompt-as-object regressions
    expect(typeof capturedInputs[0]?.prompt).toBe("string");
    expect((capturedInputs[0]?.prompt ?? "").length).toBeGreaterThan(0);

    // Should have progress, item-updated, done
    expect(events.some((e) => e.type === "progress")).toBe(true);
    expect(
      events.some(
        (e) => e.type === "item-updated" && (e as { itemId: string }).itemId === "__meta__",
      ),
    ).toBe(true);
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    const doneStats = (done as any).stats;
    expect(doneStats.itemsUpdated).toBe(1);
    expect(doneStats.aiCalls).toHaveLength(1);
    expect(doneStats.aiCalls[0].status).toBe("ok");

    // Check spec.meta.bootstrap was written
    const written = await spec.read();
    expect(written).not.toBeNull();
    const bootstrap = (written?.meta as any).bootstrap;
    expect(bootstrap).toBeTruthy();
    expect(bootstrap.description).toContain("demo app");
    expect(bootstrap.techStack).toContain("React");
    expect(bootstrap.areas).toHaveLength(1);
  });

  it("works with an empty source directory (no files)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-bootstrap-"));
    const sourceDir = mkdtempSync(path.join(tmpdir(), "specgen-bootstrap-empty-"));

    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const bootstrapJson = JSON.stringify({
      description: "Purpose unclear from inputs — README absent or generic",
      primaryAudience: "developers",
      suggestedProfile: "pm-spec",
      techStack: [],
      areas: [],
    });
    const ai = new AiRouter({ primary: fakeAi(bootstrapJson) });
    const spec = new JsonSpecRepository(dir);
    const fs = new LocalFs(sourceDir);

    const events = await runGenerator({
      rootDir: sourceDir,
      profile,
      parsers: new ParserRegistry(),
      spec,
      ai,
      fs,
    });

    expect(events.at(-1)?.type).toBe("done");
    const written = await spec.read();
    const bootstrap = (written?.meta as any).bootstrap;
    expect(bootstrap).toBeTruthy();
    expect(bootstrap.techStack).toEqual([]);
  });

  it("AI returns malformed JSON → yields warning, writes stub bootstrap, ends with done (not error)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-bootstrap-"));
    const sourceDir = mkdtempSync(path.join(tmpdir(), "specgen-bootstrap-bad-"));

    writeFileSync(path.join(sourceDir, "README.md"), "# Test");

    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const ai = new AiRouter({ primary: fakeAi("not json at all, just prose output") });
    const spec = new JsonSpecRepository(dir);
    const fs = new LocalFs(sourceDir);

    const events = await runGenerator({
      rootDir: sourceDir,
      profile,
      parsers: new ParserRegistry(),
      spec,
      ai,
      fs,
    });

    // Should have a warning event
    expect(events.some((e) => e.type === "warning")).toBe(true);
    // Should NOT have an error event
    expect(events.some((e) => e.type === "error")).toBe(false);
    // Last event should be done
    expect(events.at(-1)?.type).toBe("done");

    // Stub bootstrap should be written
    const written = await spec.read();
    const bootstrap = (written?.meta as any).bootstrap;
    expect(bootstrap).toBeTruthy();
    expect(bootstrap.description).toContain("could not be parsed");
    expect(bootstrap.techStack).toEqual([]);
    expect(bootstrap.areas).toEqual([]);

    // aiCall status should reflect json_parse_failed
    const doneStats = (events.at(-1) as any).stats;
    expect(doneStats.aiCalls[0].status).toBe("json_parse_failed");
  });

  it("no ctx.fs → yields error + done", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-bootstrap-"));

    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const ai = new AiRouter({ primary: new LocalClient() });
    const spec = new JsonSpecRepository(dir);

    const events = await runGenerator({
      rootDir: "/tmp/nonexistent",
      profile,
      parsers: new ParserRegistry(),
      spec,
      ai,
      // fs intentionally omitted
    });

    expect(events.some((e) => e.type === "error")).toBe(true);
    const errorEvent = events.find((e) => e.type === "error") as any;
    expect(errorEvent.error.message).toContain("ctx.fs");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("merges bootstrap into existing spec meta without clobbering other meta fields", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-bootstrap-"));
    const sourceDir = mkdtempSync(path.join(tmpdir(), "specgen-bootstrap-merge-"));

    writeFileSync(path.join(sourceDir, "README.md"), "# Merge Test");

    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");
    const spec = new JsonSpecRepository(dir);

    // Pre-populate spec with existing meta including backendDir
    await spec.write({
      meta: {
        target: "merge-test",
        version: "v2026.05.11",
        generatedAt: "2026-05-11T00:00:00.000Z",
        backendDir: "backend",
      },
      tree: [],
      items: {},
    });

    const bootstrapJson = JSON.stringify({
      description: "Merged project.",
      primaryAudience: "mixed",
      suggestedProfile: "pm-spec",
      techStack: ["TypeScript"],
      areas: [],
    });
    const ai = new AiRouter({ primary: fakeAi(bootstrapJson) });
    const fs = new LocalFs(sourceDir);

    await runGenerator({
      rootDir: sourceDir,
      profile,
      parsers: new ParserRegistry(),
      spec,
      ai,
      fs,
    });

    const written = await spec.read();
    // Existing meta fields must be preserved
    expect(written?.meta.target).toBe("merge-test");
    expect(written?.meta.backendDir).toBe("backend");
    expect((written?.meta as any).bootstrap.description).toBe("Merged project.");
  });
});
