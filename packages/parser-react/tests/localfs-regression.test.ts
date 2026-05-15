import { describe, expect, it } from "vitest";
import { LocalFs } from "../../core/src/parser/LocalFs.js";
import { reactParser } from "../src/index.js";

const MOCKPMS = process.env.SPECGEN_MOCKPMS_PATH;

describe.skipIf(!MOCKPMS)("parser-react via LocalFs", () => {
  it("detects React presence in MockPMS frontend and parses without throwing", async () => {
    const frontendDir = `${MOCKPMS}/frontend`;
    const fsys = new LocalFs(frontendDir);
    const detect = await reactParser.detect({ rootDir: frontendDir, fs: fsys });
    expect(detect.confidence).toBeGreaterThan(0);
    // Parser must not throw and must return a valid ParseResult
    const result = await reactParser.parse({ rootDir: frontendDir, fs: fsys });
    expect(Array.isArray(result.pages)).toBe(true);
    // MockPMS frontend uses a project-references tsconfig.json (files: []) which ts-morph
    // handles with reduced discovery — page count may be 0 but the parser must not crash.
    // This is pre-existing behaviour unchanged by the LocalFs refactor (D.5 will add hydration).
    expect(result.warnings).toBeDefined();
  });
});
