import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/commands/parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");
// MockPMS lives outside the monorepo; resolve via env var or sibling-dir fallback.
const MOCKPMS =
  process.env.SPECGEN_MOCKPMS_PATH ?? path.resolve(__dirname, "../../../../../MockPMS");

describe("parseCommand", () => {
  it.skipIf(!existsSync(MOCKPMS))(
    "parses MockPMS end-to-end",
    async () => {
      const dataDir = mkdtempSync(path.join(tmpdir(), "specgen-cli-parse-"));
      const r = await parseCommand({
        root: MOCKPMS,
        dataDir,
        profile: "pm-spec",
        provider: "local", // force the deterministic stub; never call a real AI provider in tests
        quiet: true,
        packagedProfilesDir: PACKAGED_PROFILES,
      });
      expect(r.status).toBe("success");
      expect(r.itemsCreated + r.itemsUpdated).toBeGreaterThan(0);
    },
    60_000,
  );

  it("returns error for unknown generator", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "specgen-cli-parse-err-"));
    const r = await parseCommand({
      root: process.cwd(),
      dataDir,
      profile: "pm-spec",
      generator: "no-such-generator",
      provider: "local",
      quiet: true,
      packagedProfilesDir: PACKAGED_PROFILES,
    });
    expect(r.status).toBe("error");
  });
});
