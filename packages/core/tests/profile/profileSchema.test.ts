import { describe, expect, it } from "vitest";
import { profileManifestSchema } from "../../src/profile/profileSchema.js";

describe("profileManifestSchema", () => {
  it("accepts a minimal valid manifest", () => {
    const input = {
      schemaVersion: 1,
      id: "pm-spec",
      name: "PM-Facing Specification",
      version: "1.0.0",
      supports_generators: ["full-tree-spec"],
      supports_item_types: ["backend-endpoint"],
    };
    const parsed = profileManifestSchema.parse(input);
    expect(parsed.id).toBe("pm-spec");
    expect(parsed.audience).toEqual([]); // default
    expect(parsed.ai.default_model).toBe("claude-haiku-4-5"); // default
  });

  it("rejects invalid id (uppercase)", () => {
    const input = {
      schemaVersion: 1,
      id: "PMSpec",
      name: "X",
      version: "1.0.0",
      supports_generators: ["full-tree-spec"],
      supports_item_types: ["backend-endpoint"],
    };
    expect(() => profileManifestSchema.parse(input)).toThrow();
  });

  it("rejects unknown schemaVersion", () => {
    const input = {
      schemaVersion: 99,
      id: "x",
      name: "X",
      version: "1.0.0",
      supports_generators: ["g"],
      supports_item_types: ["t"],
    };
    expect(() => profileManifestSchema.parse(input)).toThrow();
  });

  it("rejects empty supports_generators", () => {
    const input = {
      schemaVersion: 1,
      id: "x",
      name: "X",
      version: "1.0.0",
      supports_generators: [],
      supports_item_types: ["t"],
    };
    expect(() => profileManifestSchema.parse(input)).toThrow();
  });

  it("rejects malformed semver in version", () => {
    const input = {
      schemaVersion: 1,
      id: "x",
      name: "X",
      version: "not-semver",
      supports_generators: ["g"],
      supports_item_types: ["t"],
    };
    expect(() => profileManifestSchema.parse(input)).toThrow();
  });

  it("preserves extends as null when omitted", () => {
    const parsed = profileManifestSchema.parse({
      schemaVersion: 1,
      id: "x",
      name: "X",
      version: "1.0.0",
      supports_generators: ["g"],
      supports_item_types: ["t"],
    });
    expect(parsed.extends).toBeNull();
  });
});
