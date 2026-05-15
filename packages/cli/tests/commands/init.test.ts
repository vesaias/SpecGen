import { existsSync, mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCommand } from "../../src/commands/init.js";

describe("initCommand", () => {
  it("creates .specgen/config.yaml in an empty dir", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-init-"));
    const r = await initCommand({ cwd: dir });
    expect(r.status).toBe("created");
    expect(existsSync(path.join(dir, ".specgen", "config.yaml"))).toBe(true);
  });

  it("returns already-exists when run twice", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-init-"));
    await initCommand({ cwd: dir });
    const r = await initCommand({ cwd: dir });
    expect(r.status).toBe("already-exists");
  });

  it("writes valid YAML that can be parsed back", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-init-"));
    const r = await initCommand({ cwd: dir });
    expect(r.status).toBe("created");
    const raw = await readFile(path.join(dir, ".specgen", "config.yaml"), "utf8");
    const { parse } = await import("yaml");
    const parsed = parse(raw) as Record<string, unknown>;
    // Should have a profile key
    expect(typeof parsed.profile).toBe("string");
    // Should have dataDir key
    expect(typeof parsed.dataDir).toBe("string");
  });
});
