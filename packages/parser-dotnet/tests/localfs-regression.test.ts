import { describe, expect, it } from "vitest";
import { LocalFs } from "../../core/src/parser/LocalFs.js";
import { dotnetParser } from "../src/index.js";

const MOCKPMS = process.env.SPECGEN_MOCKPMS_PATH;

describe.skipIf(!MOCKPMS)("parser-dotnet via LocalFs", () => {
  it("parses MockPMS backend with identical endpoint count vs pre-refactor", async () => {
    const backendDir = `${MOCKPMS}/backend`;
    const fsys = new LocalFs(backendDir);
    const detect = await dotnetParser.detect({ rootDir: backendDir, fs: fsys });
    expect(detect.confidence).toBeGreaterThan(0);
    const result = await dotnetParser.parse({ rootDir: backendDir, fs: fsys });
    expect(result.endpoints!.length).toBeGreaterThan(20);
    expect(result.events!.length).toBeGreaterThan(0);
  });
});
