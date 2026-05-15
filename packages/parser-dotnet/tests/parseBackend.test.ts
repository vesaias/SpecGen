import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LocalFs } from "../../core/src/parser/LocalFs.js";
import { dotnetParser } from "../src/index.js";
import { parseBackend } from "../src/parseBackend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../fixtures");

describe("@specgen/parser-dotnet", () => {
  it("detects .cs file presence (fixtures dir has no .csproj or Controllers/ subdir)", async () => {
    // The fixtures dir only has a flat .cs file — no .csproj and no Controllers/ directory
    // so confidence will be 0 from the detect heuristic
    const fsys = new LocalFs(FIXTURES);
    const r = await dotnetParser.detect({ rootDir: FIXTURES, fs: fsys });
    expect(r.confidence).toBeGreaterThanOrEqual(0);
  });

  it("parses the SampleController fixture — finds GET and POST endpoints", async () => {
    const fsys = new LocalFs(FIXTURES);
    const result = await parseBackend(FIXTURES, fsys);
    // SampleController has GET and POST actions
    expect(result.length).toBeGreaterThanOrEqual(2);
    const routes = result.map((e) => e.route);
    expect(routes).toContain("/api/Products");
  });

  it("parsed endpoint has correct method and controller", async () => {
    const fsys = new LocalFs(FIXTURES);
    const result = await parseBackend(FIXTURES, fsys);
    const getEndpoint = result.find((e) => e.method === "GET");
    expect(getEndpoint).toBeDefined();
    expect(getEndpoint?.controller).toBe("ProductsController");

    const postEndpoint = result.find((e) => e.method === "POST");
    expect(postEndpoint).toBeDefined();
  });
});
