import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ParserRegistry, subdirAwarePlugin } from "@specgen/core";
import type {
  AiClient,
  AiCompletionInput,
  AiCompletionResult,
  ParserFileSystem,
} from "@specgen/core";
import { dotnetParser } from "@specgen/parser-dotnet";
import { reactParser } from "@specgen/parser-react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeProject } from "../../src/services/probeProject.js";

/**
 * probeProject — integration coverage for the AI-augmented classification
 * field. We mock the AI so the test is deterministic and offline.
 */

function makeStubAi(response: string): AiClient {
  return {
    provider: "stub",
    models: [{ id: "stub-model", displayName: "Stub" }],
    async complete(_input: AiCompletionInput): Promise<AiCompletionResult> {
      return {
        text: response,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
      };
    },
  };
}

describe("probeProject — aiClassification", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "specgen-probe-ai-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("populates aiClassification when pickAi returns a client", async () => {
    // Lay down a small local repo with a single package.json so something
    // matches and the file system is non-empty.
    writeFileSync(path.join(tmpRoot, "README.md"), "# demo");
    writeFileSync(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { react: "18" } }),
    );
    mkdirSync(path.join(tmpRoot, "src"));
    writeFileSync(path.join(tmpRoot, "src", "App.tsx"), "export default () => null;");

    const aiJson = JSON.stringify({
      summary: "Single-page React app.",
      projects: [
        {
          kind: "frontend-react",
          rootDir: "/",
          framework: "react",
          confidence: 0.88,
          suggestedParsers: ["react"],
          notes: "react in dependencies",
        },
      ],
    });
    const client = makeStubAi(aiJson);

    const parsers = new ParserRegistry();
    parsers.register(subdirAwarePlugin(dotnetParser));
    parsers.register(subdirAwarePlugin(reactParser));

    const buildGitHubFs = () => {
      throw new Error("not used in local test");
    };

    const report = await probeProject(
      { source: { type: "local", localPath: tmpRoot } },
      parsers,
      buildGitHubFs as unknown as (cfg: {
        owner: string;
        repo: string;
        ref: string;
        token: string;
      }) => ParserFileSystem | Promise<ParserFileSystem>,
      { pickAi: () => ({ client, model: "stub-model" }) },
    );

    expect(report.aiClassification).not.toBeNull();
    expect(report.aiClassification?.projects).toHaveLength(1);
    expect(report.aiClassification?.projects[0]?.kind).toBe("frontend-react");
    expect(report.aiClassification?.projects[0]?.suggestedParsers).toEqual(["react"]);
  });

  it("aiClassification is null when no AI is configured", async () => {
    writeFileSync(path.join(tmpRoot, "README.md"), "# minimal");

    const parsers = new ParserRegistry();
    parsers.register(subdirAwarePlugin(dotnetParser));
    parsers.register(subdirAwarePlugin(reactParser));

    const buildGitHubFs = () => {
      throw new Error("not used");
    };

    const report = await probeProject(
      { source: { type: "local", localPath: tmpRoot } },
      parsers,
      buildGitHubFs as unknown as (cfg: {
        owner: string;
        repo: string;
        ref: string;
        token: string;
      }) => ParserFileSystem | Promise<ParserFileSystem>,
      { pickAi: () => null },
    );

    expect(report.aiClassification ?? null).toBeNull();
  });

  it("aiClassification is null when the AI call throws", async () => {
    writeFileSync(path.join(tmpRoot, "README.md"), "# x");

    const failingClient: AiClient = {
      provider: "stub",
      models: [],
      async complete() {
        throw new Error("rate limited");
      },
    };

    const parsers = new ParserRegistry();
    parsers.register(subdirAwarePlugin(dotnetParser));
    parsers.register(subdirAwarePlugin(reactParser));

    const report = await probeProject(
      { source: { type: "local", localPath: tmpRoot } },
      parsers,
      (() => {
        throw new Error("nope");
      }) as unknown as (cfg: {
        owner: string;
        repo: string;
        ref: string;
        token: string;
      }) => ParserFileSystem | Promise<ParserFileSystem>,
      { pickAi: () => ({ client: failingClient, model: "stub-model" }) },
    );

    // classifyProject swallows AiClient throws and returns null itself, so
    // the report should carry null (not undefined).
    expect(report.aiClassification).toBeNull();
  });
});
