import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ProfileLoader } from "../../src/profile/ProfileLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES = path.resolve(__dirname, "../../profiles");

async function listShippedProfileIds(): Promise<string[]> {
  const entries = await fs.readdir(PROFILES, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

describe("shipped profiles smoke", () => {
  it("includes the expected shipped profiles", async () => {
    const ids = await listShippedProfileIds();
    // pm-old may exist locally for operator use but is gitignored and never
    // shipped in the public repo or the Docker image. Assert the public set.
    const shipped = ids.filter((id) => id !== "pm-old");
    expect(shipped).toEqual(["dev-api-reference", "pm-spec"]);
  });

  it("every shipped profile loads without throwing + manifest validates", async () => {
    const ids = await listShippedProfileIds();
    const loader = new ProfileLoader({ packagedRoot: PROFILES });

    for (const id of ids) {
      const profile = await loader.load(id);
      expect(profile.manifest.id).toBe(id);
      expect(profile.manifest.name.length).toBeGreaterThan(0);
      expect(profile.manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("every supports_item_types entry has a corresponding prompts/<type>.md file that resolves", async () => {
    const ids = await listShippedProfileIds();
    const loader = new ProfileLoader({ packagedRoot: PROFILES });

    for (const id of ids) {
      const profile = await loader.load(id);
      for (const itemType of profile.manifest.supports_item_types) {
        const text = await profile.promptFor(itemType);
        expect(text.length).toBeGreaterThan(50); // non-trivial content
      }
    }
  });

  it("every shipped profile has a README.md", async () => {
    const ids = await listShippedProfileIds();
    for (const id of ids) {
      const readmePath = path.join(PROFILES, id, "README.md");
      const stat = await fs.stat(readmePath);
      expect(stat.isFile()).toBe(true);
    }
  });

  it("every shipped profile's supports_generators is non-empty", async () => {
    const ids = await listShippedProfileIds();
    const loader = new ProfileLoader({ packagedRoot: PROFILES });
    for (const id of ids) {
      const profile = await loader.load(id);
      expect(profile.manifest.supports_generators.length).toBeGreaterThan(0);
    }
  });
});
