/**
 * Smoke test for full-tree-spec generator against the MockPMS target.
 *
 * MockPMS now lives outside this monorepo (it's a separate codebase).
 * The test resolves it via SPECGEN_MOCKPMS_PATH env var, falling back to a
 * sibling directory `../MockPMS`. If neither exists, the suite is skipped.
 *
 * MockPMS layout:
 *   <MOCKPMS_ROOT>/
 *     backend/   ← .NET C# (Controllers/, .csproj, Events/)
 *     frontend/  ← React/TS (src/, package.json)
 *
 * The dotnet and react parsers detect at the directory level where their
 * markers live (Controllers/+.csproj for dotnet; package.json for react).
 * We register thin adapter plugins that re-root detect/parse to the correct subdirs.
 */

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Import directly from source (packages are not pre-built in the monorepo dev setup)
import { dotnetParser } from "../../../parser-dotnet/src/index.js";
import { reactParser } from "../../../parser-react/src/index.js";
import { AiRouter } from "../../src/ai/AiRouter.js";
import { LocalClient } from "../../src/ai/providers/LocalClient.js";
import { fullTreeSpecGenerator } from "../../src/generator/builtins/full-tree-spec.js";
import { LocalFs } from "../../src/parser/LocalFs.js";
import type { ParserPlugin } from "../../src/parser/Parser.js";
import { ParserRegistry } from "../../src/parser/ParserRegistry.js";
import type { DetectInput, DetectResult, ParseInput, ParseResult } from "../../src/parser/types.js";
import { ProfileLoader } from "../../src/profile/ProfileLoader.js";
import { JsonSpecRepository } from "../../src/spec/JsonSpecRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES = path.resolve(__dirname, "../../profiles");
const MOCKPMS =
  process.env.SPECGEN_MOCKPMS_PATH ?? path.resolve(__dirname, "../../../../../MockPMS");

/**
 * Creates an adapter plugin that re-roots detect/parse to a specific subdir.
 * This allows parsers that detect at the dir-level to work when the caller
 * provides a parent rootDir (e.g. "mock-pms" instead of "mock-pms/backend").
 */
function subdirAdapter(plugin: ParserPlugin, subdir: string): ParserPlugin {
  return {
    ...plugin,
    async detect(input: DetectInput): Promise<DetectResult> {
      const subRootDir = path.join(input.rootDir, subdir);
      return plugin.detect({ rootDir: subRootDir, fs: new LocalFs(subRootDir) });
    },
    async parse(input: ParseInput): Promise<ParseResult> {
      const subRootDir = path.join(input.rootDir, subdir);
      return plugin.parse({ ...input, rootDir: subRootDir, fs: new LocalFs(subRootDir) });
    },
  };
}

describe.skipIf(!existsSync(MOCKPMS))("full-tree-spec generator (MockPMS smoke)", () => {
  it("parses MockPMS and writes a Spec via JsonSpecRepository", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "specgen-mockpms-"));
    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");

    // Register parsers adapted to MockPMS subdir layout
    const parsers = new ParserRegistry();
    parsers.register(subdirAdapter(dotnetParser, "backend"));
    parsers.register(subdirAdapter(reactParser, "frontend"));

    const spec = new JsonSpecRepository(dataDir);
    const events: GeneratorEventType[] = [];
    const messages: string[] = [];

    for await (const e of fullTreeSpecGenerator.run({
      rootDir: MOCKPMS,
      profile,
      parsers,
      spec,
      ai: new AiRouter({ primary: new LocalClient() }),
      log: (msg) => messages.push(msg),
    })) {
      events.push(e.type);
    }

    // Generator must finish with a 'done' event
    expect(events).toContain("done");
    expect(events.at(-1)).toBe("done");

    // Spec was written
    const finalSpec = await spec.read();
    expect(finalSpec).not.toBeNull();

    // MockPMS has endpoints, pages, events — minimum 10 items total
    const itemCount = Object.keys(finalSpec?.items).length;
    expect(itemCount).toBeGreaterThanOrEqual(10);

    // Meta is populated. Target name is derived from the dir basename, so don't
    // assert a literal value (the dir may be named MockPMS, mock-pms, etc).
    expect(finalSpec?.meta.target).toBeTruthy();
    expect(finalSpec?.meta.generatedAt).toBeTruthy();

    // Tree is built
    expect(finalSpec?.tree.length).toBeGreaterThan(0);

    // Items have expected types
    const types = new Set(Object.values(finalSpec?.items).map((i) => i.type));
    expect(types.has("backend")).toBe(true);
  }, 60_000); // allow up to 60s for parsing

  it("second run merges without losing data (idempotent)", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "specgen-mockpms-merge-"));
    const profile = await new ProfileLoader({ packagedRoot: PROFILES }).load("pm-spec");

    const parsers = new ParserRegistry();
    parsers.register(subdirAdapter(dotnetParser, "backend"));
    parsers.register(subdirAdapter(reactParser, "frontend"));

    const spec = new JsonSpecRepository(dataDir);

    // First run
    const run1Events: string[] = [];
    for await (const e of fullTreeSpecGenerator.run({
      rootDir: MOCKPMS,
      profile,
      parsers,
      spec,
      ai: new AiRouter({ primary: new LocalClient() }),
    })) {
      run1Events.push(e.type);
    }
    const spec1 = await spec.read();
    const count1 = Object.keys(spec1?.items).length;

    // Second run (re-parse same code — should produce same item count)
    const parsers2 = new ParserRegistry();
    parsers2.register(subdirAdapter(dotnetParser, "backend"));
    parsers2.register(subdirAdapter(reactParser, "frontend"));

    for await (const _e of fullTreeSpecGenerator.run({
      rootDir: MOCKPMS,
      profile,
      parsers: parsers2,
      spec,
      ai: new AiRouter({ primary: new LocalClient() }),
    })) {
      /* drain */
    }
    const spec2 = await spec.read();
    const count2 = Object.keys(spec2?.items).length;

    expect(count2).toBe(count1);
  }, 60_000);
});

// Helper type for events
type GeneratorEventType = Awaited<
  ReturnType<typeof fullTreeSpecGenerator.run>
> extends AsyncIterable<infer E>
  ? E["type"]
  : never;
