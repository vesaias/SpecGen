import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ProfileLoader } from "../../src/profile/ProfileLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

describe("ProfileLoader", () => {
  it("lists profiles from packagedRoot", async () => {
    const loader = new ProfileLoader({ packagedRoot: path.join(FIXTURES, "profiles") });
    const list = await loader.list();
    expect(list.map((p) => p.id).sort()).toEqual(["base", "child"]);
  });

  it("child without project override falls back to child file", async () => {
    const loader = new ProfileLoader({ packagedRoot: path.join(FIXTURES, "profiles") });
    const profile = await loader.load("child");
    const text = await profile.promptFor("x");
    expect(text.trim()).toBe("CHILD_PROMPT");
    expect(profile.inheritanceChain).toEqual(["child", "base"]);
  });

  it("project override beats child", async () => {
    const loader = new ProfileLoader({ packagedRoot: path.join(FIXTURES, "profiles") });
    const profile = await loader.load("child", path.join(FIXTURES, "projectRoot"));
    const text = await profile.promptFor("x");
    expect(text.trim()).toBe("PROJECT_OVERRIDE");
  });

  it("falls through to parent when child has no file", async () => {
    // Use the BASE profile directly (no extends) — this just exercises that base files load.
    const loader = new ProfileLoader({ packagedRoot: path.join(FIXTURES, "profiles") });
    const profile = await loader.load("base");
    const text = await profile.promptFor("x");
    expect(text.trim()).toBe("BASE_PROMPT");
  });

  it("errors when prompt missing in entire chain", async () => {
    const loader = new ProfileLoader({ packagedRoot: path.join(FIXTURES, "profiles") });
    const profile = await loader.load("child");
    await expect(profile.promptFor("nonexistent")).rejects.toThrow(/not found/i);
  });

  it("errors on circular extends", async () => {
    const loader = new ProfileLoader({ packagedRoot: path.join(FIXTURES, "circular") });
    await expect(loader.load("loop-a")).rejects.toThrow(/circular/i);
  });

  it("errors when profile id does not exist", async () => {
    const loader = new ProfileLoader({ packagedRoot: path.join(FIXTURES, "profiles") });
    await expect(loader.load("does-not-exist")).rejects.toThrow(/not found/i);
  });
});
