import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AiClient,
  AiClientModel,
  AiCompletionInput,
  AiCompletionResult,
  ParseResult,
} from "@specgen/core";
import { LocalFs } from "@specgen/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { llmParser, parseRepo } from "../src/index.js";

// ---------------------------------------------------------------------------
// Mock AI client
// ---------------------------------------------------------------------------

interface RecordedCall {
  prompt: string;
  system: string | undefined;
  model: string;
}

class MockAiClient implements AiClient {
  readonly provider = "mock";
  readonly models: ReadonlyArray<AiClientModel> = [
    { id: "mock-model", displayName: "Mock", contextWindow: 100_000 },
  ];

  readonly calls: RecordedCall[] = [];
  /** Promise-returning responders keyed by file path substring. */
  private responders: Array<(call: RecordedCall) => string | null> = [];
  /** Concurrency tracking — for the concurrency-cap test. */
  inFlight = 0;
  maxInFlight = 0;
  /** Resolvers that gate when each call completes. Indexed by call order. */
  gates: Array<() => void> = [];
  /** When true, complete() returns immediately (default for most tests). */
  immediate = true;

  on(match: (call: RecordedCall) => boolean, body: string | object) {
    this.responders.push((call) => (match(call) ? bodyAsText(body) : null));
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const call: RecordedCall = {
      prompt: input.prompt,
      system: input.system,
      model: input.model,
    };
    this.calls.push(call);
    this.inFlight++;
    if (this.inFlight > this.maxInFlight) this.maxInFlight = this.inFlight;

    if (!this.immediate) {
      await new Promise<void>((resolve) => {
        this.gates.push(resolve);
      });
    }

    let body = '{"endpoints":[],"events":[],"pages":[]}';
    for (const r of this.responders) {
      const out = r(call);
      if (out !== null) {
        body = out;
        break;
      }
    }

    this.inFlight--;
    return {
      text: body,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
    };
  }
}

function bodyAsText(body: string | object): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const dirs: string[] = [];

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-llm-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return dir;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

beforeEach(() => {
  // no-op
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("@specgen/parser-llm — detect()", () => {
  it("returns confidence 0.5 when any source file is present", async () => {
    const dir = makeRepo({ "src/app.py": "print('hi')\n" });
    const fsys = new LocalFs(dir);
    const r = await llmParser.detect({ rootDir: dir, fs: fsys });
    expect(r.confidence).toBe(0.5);
  });

  it("returns confidence 0 when no source files are present", async () => {
    const dir = makeRepo({ "README.md": "hi" });
    const fsys = new LocalFs(dir);
    const r = await llmParser.detect({ rootDir: dir, fs: fsys });
    expect(r.confidence).toBe(0);
  });
});

describe("@specgen/parser-llm — parse() with mocked AI", () => {
  it("populates BackendSpec fields from a backend-flavoured file", async () => {
    const dir = makeRepo({
      "controllers/users.py": "@app.get('/users/{id}')\ndef get_user(id: int): return {'id': id}\n",
    });
    const ai = new MockAiClient();
    ai.on((c) => c.prompt.includes("controllers/users.py"), {
      endpoints: [
        {
          method: "GET",
          route: "/users/{id}",
          controller: "UsersController",
          parameters: [
            {
              name: "id",
              location: "path",
              type: "int",
              required: true,
              description: "User id",
            },
          ],
          responses: [{ status: 200, type: "User", description: "OK" }],
          sourceFiles: ["controllers/users.py"],
          summary: "[TODO: Human fills]",
          context: "[TODO: Human fills]",
        },
      ],
      events: [],
    });

    const result = await parseRepo({
      rootDir: dir,
      fs: new LocalFs(dir),
      aiClient: ai,
      aiModel: "mock-model",
    });

    expect(result.endpoints).toHaveLength(1);
    const ep = result.endpoints![0]!;
    expect(ep.method).toBe("GET");
    expect(ep.route).toBe("/users/{id}");
    expect(ep.controller).toBe("UsersController");
    expect(ep.parameters[0]?.name).toBe("id");
    expect(ep.parameters[0]?.location).toBe("path");
    expect(ep.sourceFiles).toContain("controllers/users.py");
  });

  it("populates FrontendSpec fields from a .tsx file", async () => {
    const dir = makeRepo({
      "src/pages/Home.tsx": "export default function Home() { return <div/>; }\n",
    });
    const ai = new MockAiClient();
    ai.on((c) => c.prompt.includes("Home.tsx"), {
      pages: [
        {
          page: "HomePage",
          route: "/",
          context: "[TODO: Human fills]",
          sourceFiles: ["src/pages/Home.tsx"],
          sections: [],
          navigation: [],
          actions: [],
          state: [],
          apiCalls: [],
        },
      ],
    });

    const result = await parseRepo({
      rootDir: dir,
      fs: new LocalFs(dir),
      aiClient: ai,
      aiModel: "mock-model",
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages![0]!.page).toBe("HomePage");
    expect(result.pages![0]!.route).toBe("/");
    expect(result.pages![0]!.sourceFiles).toContain("src/pages/Home.tsx");
  });

  it("returns a warning and empty result when aiClient is missing", async () => {
    const dir = makeRepo({ "controllers/u.py": "x = 1\n" });
    const result = await parseRepo({ rootDir: dir, fs: new LocalFs(dir) });
    expect(result.endpoints).toEqual([]);
    expect(result.pages).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.warnings.some((w) => /no aiClient/i.test(w))).toBe(true);
  });
});

describe("@specgen/parser-llm — fallback mode", () => {
  it("skips files already covered by the rule parser output", async () => {
    const dir = makeRepo({
      "controllers/a.py": "x=1\n",
      "controllers/b.py": "y=2\n",
    });
    const ai = new MockAiClient();
    // Every file gets the empty default response so we can just count calls.

    const ruleParserOutput: ParseResult = {
      endpoints: [
        {
          endpoint: "GET /a",
          method: "GET",
          route: "/a",
          controller: "A",
          summary: "",
          context: "",
          parameters: [],
          responses: [],
          validationRules: [],
          orchestration: [],
          dependencies: [],
          sourceFiles: ["controllers/a.py"],
        },
      ],
      warnings: [],
    };

    await parseRepo({
      rootDir: dir,
      fs: new LocalFs(dir),
      aiClient: ai,
      aiModel: "mock-model",
      config: { llm: { mode: "fallback" } },
      ruleParserOutput,
    });

    // Only b.py should hit the AI; a.py is covered by ruleParserOutput.
    const paths = ai.calls.map((c) => c.prompt.match(/File: ([^\n]+)/)?.[1] ?? "");
    expect(paths).toContain("controllers/b.py");
    expect(paths).not.toContain("controllers/a.py");
  });

  it("standalone mode processes every relevant file even when ruleParserOutput is provided", async () => {
    const dir = makeRepo({
      "controllers/a.py": "x=1\n",
      "controllers/b.py": "y=2\n",
    });
    const ai = new MockAiClient();
    const ruleParserOutput: ParseResult = {
      endpoints: [
        {
          endpoint: "GET /a",
          method: "GET",
          route: "/a",
          controller: "A",
          summary: "",
          context: "",
          parameters: [],
          responses: [],
          validationRules: [],
          orchestration: [],
          dependencies: [],
          sourceFiles: ["controllers/a.py"],
        },
      ],
      warnings: [],
    };

    await parseRepo({
      rootDir: dir,
      fs: new LocalFs(dir),
      aiClient: ai,
      aiModel: "mock-model",
      config: { llm: { mode: "standalone" } },
      ruleParserOutput,
    });

    const paths = ai.calls.map((c) => c.prompt.match(/File: ([^\n]+)/)?.[1] ?? "");
    expect(paths).toContain("controllers/a.py");
    expect(paths).toContain("controllers/b.py");
  });
});

describe("@specgen/parser-llm — concurrency", () => {
  it("never runs more than `opts.concurrency` AI calls at once", async () => {
    // Six backend files; concurrency = 2.
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) files[`controllers/h${i}.py`] = "x=1\n";
    const dir = makeRepo(files);
    const ai = new MockAiClient();
    ai.immediate = false;

    const promise = parseRepo({
      rootDir: dir,
      fs: new LocalFs(dir),
      aiClient: ai,
      aiModel: "mock-model",
      config: { llm: { mode: "standalone", concurrency: 2 } },
    });

    // Drain the gates serially: at any moment only `concurrency` calls
    // should be in-flight. The waitForCalls helper polls until at least N
    // calls have started.
    async function waitForCalls(n: number) {
      for (let attempt = 0; attempt < 100 && ai.calls.length < n; attempt++) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    // After a bit, two calls should be in flight (the concurrency limit).
    await waitForCalls(2);
    expect(ai.inFlight).toBeLessThanOrEqual(2);
    expect(ai.maxInFlight).toBeLessThanOrEqual(2);

    // Release them all
    while (ai.gates.length || ai.inFlight > 0) {
      const g = ai.gates.shift();
      if (g) g();
      await new Promise((r) => setTimeout(r, 5));
    }

    await promise;

    // 6 files -> 6 calls
    expect(ai.calls.length).toBe(6);
    // Concurrency cap was respected throughout.
    expect(ai.maxInFlight).toBeLessThanOrEqual(2);
    expect(ai.maxInFlight).toBeGreaterThanOrEqual(1);
  });
});

describe("@specgen/parser-llm — heuristics", () => {
  it("ignores test directories", async () => {
    const dir = makeRepo({
      "src/handler.py": "x=1\n",
      "tests/test_handler.py": "y=1\n",
      "src/__tests__/spec.test.ts": "z=1\n",
    });
    const ai = new MockAiClient();
    await parseRepo({
      rootDir: dir,
      fs: new LocalFs(dir),
      aiClient: ai,
      aiModel: "mock-model",
      config: { llm: { mode: "standalone" } },
    });
    const paths = ai.calls.map((c) => c.prompt.match(/File: ([^\n]+)/)?.[1] ?? "");
    expect(paths).toContain("src/handler.py");
    expect(paths).not.toContain("tests/test_handler.py");
    expect(paths).not.toContain("src/__tests__/spec.test.ts");
  });

  it("ignores node_modules / dist / .git", async () => {
    const dir = makeRepo({
      "src/app.ts": "x=1\n",
      "node_modules/foo/index.js": "y=1\n",
      "dist/app.js": "z=1\n",
      ".git/config": "[core]\n",
    });
    const ai = new MockAiClient();
    await parseRepo({
      rootDir: dir,
      fs: new LocalFs(dir),
      aiClient: ai,
      aiModel: "mock-model",
      config: { llm: { mode: "standalone" } },
    });
    const paths = ai.calls.map((c) => c.prompt.match(/File: ([^\n]+)/)?.[1] ?? "");
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("node_modules/foo/index.js");
    expect(paths).not.toContain("dist/app.js");
  });
});
