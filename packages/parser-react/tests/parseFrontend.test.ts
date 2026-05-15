import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LocalFs } from "../../core/src/parser/LocalFs.js";
import { reactParser } from "../src/index.js";
import { parseFrontend } from "../src/parseFrontend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../fixtures/sample-app");

describe("@specgen/parser-react", () => {
  it("detects React via package.json", async () => {
    const fsys = new LocalFs(FIXTURES);
    const r = await reactParser.detect({ rootDir: FIXTURES, fs: fsys });
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBe(0.9);
  });

  it("parses sample-app fixture — returns an array", async () => {
    const fsys = new LocalFs(FIXTURES);
    const pages = await parseFrontend(FIXTURES, fsys);
    expect(Array.isArray(pages)).toBe(true);
  });

  it("parses Dashboard page from sample-app fixture", async () => {
    const fsys = new LocalFs(FIXTURES);
    const pages = await parseFrontend(FIXTURES, fsys);
    // The fixture has one route "/" → Dashboard
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const dashboard = pages.find((p) => p.page === "Dashboard");
    expect(dashboard).toBeDefined();
    expect(dashboard?.route).toBe("/");
  });
});
