import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalFs } from "../../core/src/parser/LocalFs.js";
import { pythonParser } from "../src/index.js";
import { parseBackend } from "../src/parseBackend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");

describe("@specgen/parser-python — detect()", () => {
  it("detects ≥3 .py files at the fixture root (no pyproject.toml present)", async () => {
    const fsys = new LocalFs(FIXTURES);
    const r = await pythonParser.detect({ rootDir: FIXTURES, fs: fsys });
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("returns confidence 0.8 when pyproject.toml is present", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-py-detect-pyproject-"));
    writeFileSync(path.join(dir, "pyproject.toml"), '[project]\nname = "x"\n');
    try {
      const fsys = new LocalFs(dir);
      const r = await pythonParser.detect({ rootDir: dir, fs: fsys });
      expect(r.confidence).toBe(0.8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns confidence 0 for an empty directory with no Python signals", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-py-detect-empty-"));
    try {
      const fsys = new LocalFs(dir);
      const r = await pythonParser.detect({ rootDir: dir, fs: fsys });
      expect(r.confidence).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("@specgen/parser-python — FastAPI extraction", () => {
  let fastApiDir: string;

  beforeAll(() => {
    // Build a tmpdir containing ONLY fastapi.py — verifies the parser works
    // even when no other py files (and Pydantic context comes from the same file).
    fastApiDir = mkdtempSync(path.join(tmpdir(), "specgen-py-fastapi-"));
    const src = path.join(FIXTURES, "fastapi.py");
    // Copy by reading + writing to avoid Windows symlink quirks.
    // We need the file to also satisfy detect()'s ≥3-py-files trigger, so write
    // a couple of empty stub files alongside.
    writeFileSync(path.join(fastApiDir, "fastapi.py"), readFile(src));
    writeFileSync(path.join(fastApiDir, "__init__.py"), "");
    writeFileSync(path.join(fastApiDir, "_stub.py"), "");
  });

  afterAll(() => {
    rmSync(fastApiDir, { recursive: true, force: true });
  });

  it("emits the 3 expected endpoints with include_router prefix applied", async () => {
    const fsys = new LocalFs(fastApiDir);
    const result = await parseBackend({ rootDir: fastApiDir, fs: fsys });
    const endpoints = result.endpoints ?? [];
    const routes = endpoints.map((e) => `${e.method} ${e.route}`);
    expect(routes).toContain("GET /api/v1/users/{user_id}");
    expect(routes).toContain("POST /api/v1/users");
    expect(routes).toContain("GET /api/v1/users");
  });

  it("extracts path params with location=path and the annotated type", async () => {
    const fsys = new LocalFs(fastApiDir);
    const result = await parseBackend({ rootDir: fastApiDir, fs: fsys });
    const getOne = result.endpoints!.find((e) => e.route === "/api/v1/users/{user_id}");
    expect(getOne).toBeDefined();
    const userIdParam = getOne!.parameters.find((p) => p.name === "user_id");
    expect(userIdParam).toBeDefined();
    expect(userIdParam!.location).toBe("path");
    expect(userIdParam!.type).toBe("int");
    expect(userIdParam!.required).toBe(true);
  });

  it("captures response_model on a 200 response entry", async () => {
    const fsys = new LocalFs(fastApiDir);
    const result = await parseBackend({ rootDir: fastApiDir, fs: fsys });
    const getOne = result.endpoints!.find((e) => e.route === "/api/v1/users/{user_id}");
    expect(getOne).toBeDefined();
    const ok = getOne!.responses.find((r) => r.status === 200);
    expect(ok).toBeDefined();
    expect(ok!.type).toBe("UserOut");
  });

  it("links a Pydantic class to the POST request body", async () => {
    const fsys = new LocalFs(fastApiDir);
    const result = await parseBackend({ rootDir: fastApiDir, fs: fsys });
    const post = result.endpoints!.find((e) => e.method === "POST" && e.route === "/api/v1/users");
    expect(post).toBeDefined();
    expect(post!.requestBody).toBeDefined();
    expect(post!.requestBody!.dtoName).toBe("UserCreate");
    const fieldNames = post!.requestBody!.fields.map((f) => f.name);
    expect(fieldNames).toEqual(expect.arrayContaining(["name", "email"]));
    // body parameter is recorded
    const bodyParam = post!.parameters.find((p) => p.location === "body");
    expect(bodyParam).toBeDefined();
    expect(bodyParam!.type).toBe("UserCreate");
  });

  it("classifies signature params without a body type as query parameters", async () => {
    const fsys = new LocalFs(fastApiDir);
    const result = await parseBackend({ rootDir: fastApiDir, fs: fsys });
    const list = result.endpoints!.find((e) => e.method === "GET" && e.route === "/api/v1/users");
    expect(list).toBeDefined();
    const limit = list!.parameters.find((p) => p.name === "limit");
    expect(limit).toBeDefined();
    expect(limit!.location).toBe("query");
    expect(limit!.required).toBe(false); // has a default
  });
});

describe("@specgen/parser-python — Flask extraction", () => {
  let flaskDir: string;

  beforeAll(() => {
    flaskDir = mkdtempSync(path.join(tmpdir(), "specgen-py-flask-"));
    writeFileSync(path.join(flaskDir, "app.py"), readFile(path.join(FIXTURES, "flask.py")));
    writeFileSync(path.join(flaskDir, "__init__.py"), "");
    writeFileSync(path.join(flaskDir, "_stub.py"), "");
  });

  afterAll(() => {
    rmSync(flaskDir, { recursive: true, force: true });
  });

  it("emits one BackendSpec per (method, path) — methods=[GET,POST] is two endpoints", async () => {
    const fsys = new LocalFs(flaskDir);
    const result = await parseBackend({ rootDir: flaskDir, fs: fsys });
    const endpoints = result.endpoints ?? [];
    const routes = endpoints.map((e) => `${e.method} ${e.route}`);
    expect(routes).toContain("GET /health");
    expect(routes).toContain("GET /api/widgets");
    expect(routes).toContain("POST /api/widgets");
    expect(routes).toContain("GET /api/widgets/<int:widget_id>");
    // 4 endpoints total
    expect(endpoints.length).toBe(4);
  });

  it("extracts Flask path params with their converter type", async () => {
    const fsys = new LocalFs(flaskDir);
    const result = await parseBackend({ rootDir: flaskDir, fs: fsys });
    const detail = result.endpoints!.find((e) => e.route.includes("widget_id"));
    expect(detail).toBeDefined();
    const param = detail!.parameters.find((p) => p.name === "widget_id");
    expect(param).toBeDefined();
    expect(param!.location).toBe("path");
    expect(param!.type).toBe("int");
  });
});

describe("@specgen/parser-python — SQLAlchemy model collection", () => {
  it("does not emit BackendSpec items for SQLAlchemy models (collected for lookup only)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-py-sa-"));
    try {
      writeFileSync(path.join(dir, "models.py"), readFile(path.join(FIXTURES, "models.py")));
      writeFileSync(path.join(dir, "__init__.py"), "");
      writeFileSync(path.join(dir, "_stub.py"), "");
      const fsys = new LocalFs(dir);
      const result = await parseBackend({ rootDir: dir, fs: fsys });
      // models.py has no routes — endpoints should be empty
      expect(result.endpoints).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Tiny synchronous helper to keep the test file dependency-light
function readFile(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs");
  return readFileSync(p, "utf8");
}
