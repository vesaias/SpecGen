import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ProfileLoader } from "../../src/profile/ProfileLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGED = path.resolve(__dirname, "../../profiles");

describe("shipped pm-spec profile", () => {
  it("loads via ProfileLoader and resolves all four item-type prompts", async () => {
    const loader = new ProfileLoader({ packagedRoot: PACKAGED });
    const profile = await loader.load("pm-spec");
    expect(profile.manifest.id).toBe("pm-spec");
    expect(profile.inheritanceChain).toEqual(["pm-spec"]);
    for (const itemType of ["backend-endpoint", "frontend-page", "domain-event", "handler"]) {
      const prompt = await profile.promptFor(itemType);
      expect(prompt.length).toBeGreaterThan(100);
    }
  });

  it("appears in the loader.list() output", async () => {
    const loader = new ProfileLoader({ packagedRoot: PACKAGED });
    const list = await loader.list();
    expect(list.find((p) => p.id === "pm-spec")).toBeDefined();
  });
});
