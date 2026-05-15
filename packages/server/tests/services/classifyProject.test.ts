import type {
  AiClient,
  AiCompletionInput,
  AiCompletionResult,
  ParserFileSystem,
} from "@specgen/core";
import { describe, expect, it, vi } from "vitest";
import { classifyProject } from "../../src/services/classifyProject.js";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface StubFile {
  name: string;
  content?: string; // omit for directories
  children?: StubFile[]; // present for directories
}

/**
 * Tiny in-memory ParserFileSystem stand-in. Only implements what classifyProject
 * actually calls: listDir + readFile. The rest throw.
 */
function makeStubFs(root: StubFile[]): ParserFileSystem {
  function resolvePath(relPath: string): StubFile[] | null {
    if (relPath === "" || relPath === "/" || relPath === ".") return root;
    const parts = relPath.split("/").filter(Boolean);
    let cur: StubFile[] | null = root;
    for (const part of parts) {
      if (!cur) return null;
      const next = cur.find((f) => f.name === part);
      if (!next || !next.children) return null;
      cur = next.children;
    }
    return cur;
  }
  function resolveFile(relPath: string): StubFile | null {
    const parts = relPath.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    let cur: StubFile[] | null = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cur) return null;
      const next = cur.find((f) => f.name === part);
      if (!next || !next.children) return null;
      cur = next.children;
    }
    if (!cur) return null;
    return cur.find((f) => f.name === parts[parts.length - 1]) ?? null;
  }
  return {
    rootDir: "/stub",
    async readFile(relPath) {
      const f = resolveFile(relPath);
      if (!f || f.children) throw new Error(`ENOENT: ${relPath}`);
      return f.content ?? "";
    },
    async exists(relPath) {
      return resolveFile(relPath) !== null;
    },
    async stat(relPath) {
      const f = resolveFile(relPath);
      if (!f) throw new Error(`ENOENT: ${relPath}`);
      return { size: f.content?.length ?? 0, isDirectory: !!f.children };
    },
    async listDir(relPath) {
      const entries = resolvePath(relPath);
      if (!entries) throw new Error(`ENOENT: ${relPath}`);
      return entries.map((e) => ({ name: e.name, isDirectory: !!e.children }));
    },
    async *walk() {
      // Not used by classifyProject.
    },
    subFs(): ParserFileSystem {
      throw new Error("subFs not implemented in stub");
    },
  };
}

function makeStubAi(response: string): {
  client: AiClient;
  lastInput: { value: AiCompletionInput | null };
} {
  const lastInput: { value: AiCompletionInput | null } = { value: null };
  const client: AiClient = {
    provider: "stub",
    models: [{ id: "stub-model", displayName: "Stub" }],
    async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
      lastInput.value = input;
      return {
        text: response,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
      };
    },
  };
  return { client, lastInput };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("classifyProject", () => {
  it("returns a parsed classification with the AI response", async () => {
    const fs = makeStubFs([
      { name: "README.md", content: "# Demo monorepo" },
      {
        name: "backend",
        children: [
          { name: "pyproject.toml", content: '[project]\nname = "demo"' },
          { name: "main.py", content: "print('hi')" },
        ],
      },
      {
        name: "frontend",
        children: [
          { name: "package.json", content: '{"name":"fe","dependencies":{"react":"18"}}' },
          { name: "App.tsx", content: "export default function App(){return null}" },
        ],
      },
    ]);

    const aiJson = JSON.stringify({
      summary: "Python backend + React frontend monorepo.",
      projects: [
        {
          kind: "backend-python",
          rootDir: "/backend",
          framework: "fastapi",
          confidence: 0.9,
          suggestedParsers: ["python"],
          notes: "pyproject.toml present",
        },
        {
          kind: "frontend-react",
          rootDir: "/frontend",
          framework: "react",
          confidence: 0.85,
          suggestedParsers: ["react"],
          notes: "react in dependencies",
        },
      ],
    });
    const { client, lastInput } = makeStubAi(aiJson);

    const result = await classifyProject(fs, { ai: client, model: "stub-model" });

    expect(result).not.toBeNull();
    expect(result?.projects).toHaveLength(2);
    expect(result?.projects[0]?.kind).toBe("backend-python");
    expect(result?.projects[0]?.rootDir).toBe("/backend");
    expect(result?.projects[1]?.kind).toBe("frontend-react");
    expect(result?.summary).toContain("monorepo");

    // Prompt should mention marker files we read.
    expect(lastInput.value?.prompt).toContain("backend/pyproject.toml");
    expect(lastInput.value?.prompt).toContain("frontend/package.json");
  });

  it("folds GitHub languages bytes into the AI prompt context", async () => {
    const fs = makeStubFs([
      { name: "README.md", content: "# repo" },
      {
        name: "weirddir",
        children: [{ name: "thing.py", content: "x=1" }],
      },
    ]);
    const aiJson = JSON.stringify({
      summary: "Mostly python.",
      projects: [
        {
          kind: "backend-python",
          rootDir: "/weirddir",
          framework: "flask",
          confidence: 0.6,
          suggestedParsers: ["python"],
          notes: "Python files in weirddir; bytes breakdown confirms.",
        },
      ],
    });
    const { client, lastInput } = makeStubAi(aiJson);

    // Stub fetch that returns the GitHub /languages payload.
    const fetchStub = vi.fn(async (url: URL | string | Request) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      expect(u).toContain("/repos/owner/repo/languages");
      return new Response(JSON.stringify({ Python: 123456, JavaScript: 4321 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await classifyProject(fs, {
      ai: client,
      model: "stub-model",
      github: { owner: "owner", repo: "repo", token: "ghp_x" },
      fetch: fetchStub as unknown as typeof globalThis.fetch,
    });

    expect(result).not.toBeNull();
    expect(result?.projects).toHaveLength(1);
    expect(result?.projects[0]?.suggestedParsers).toEqual(["python"]);

    // The bytes breakdown should appear in the AI prompt.
    expect(lastInput.value?.prompt).toContain("Python: 123456");
    expect(lastInput.value?.prompt).toContain("JavaScript: 4321");

    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it("returns null when AI returns non-JSON garbage", async () => {
    const fs = makeStubFs([{ name: "README.md", content: "hi" }]);
    const { client } = makeStubAi("sorry I cannot help with that");
    const result = await classifyProject(fs, { ai: client, model: "stub-model" });
    expect(result).toBeNull();
  });

  it("returns null when AI throws", async () => {
    const fs = makeStubFs([{ name: "README.md", content: "hi" }]);
    const client: AiClient = {
      provider: "stub",
      models: [],
      async complete(): Promise<AiCompletionResult> {
        throw new Error("boom");
      },
    };
    const result = await classifyProject(fs, { ai: client, model: "stub-model" });
    expect(result).toBeNull();
  });

  it("silently skips GitHub language fetch on 401", async () => {
    const fs = makeStubFs([{ name: "README.md", content: "hi" }]);
    const aiJson = JSON.stringify({
      summary: "minimal",
      projects: [
        {
          kind: "unknown",
          rootDir: "/",
          framework: "",
          confidence: 0.2,
          suggestedParsers: [],
          notes: "README only",
        },
      ],
    });
    const { client, lastInput } = makeStubAi(aiJson);
    const fetchStub = vi.fn(async () => new Response("nope", { status: 401 }));

    const result = await classifyProject(fs, {
      ai: client,
      model: "stub-model",
      github: { owner: "o", repo: "r", token: "bad" },
      fetch: fetchStub as unknown as typeof globalThis.fetch,
    });

    // Classifier still returned the AI's classification — the languages
    // fetch failure was swallowed.
    expect(result).not.toBeNull();
    expect(result?.projects).toHaveLength(1);

    // The prompt should NOT contain a languages breakdown when the fetch
    // failed.
    expect(lastInput.value?.prompt).not.toContain("GitHub languages");
  });
});
