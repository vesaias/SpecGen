import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProfileManifest } from "./profileSchema.js";

export interface ResolvedProfileOptions {
  manifest: ProfileManifest;
  inheritanceChain: string[]; // [self, parent, grandparent, ...]
  searchPaths: string[]; // ordered; first hit wins
}

export class ResolvedProfile {
  constructor(private readonly opts: ResolvedProfileOptions) {}

  get manifest(): ProfileManifest {
    return this.opts.manifest;
  }

  get inheritanceChain(): string[] {
    return [...this.opts.inheritanceChain];
  }

  async promptFor(itemType: string): Promise<string> {
    const fileRel = path.posix.join("prompts", `${itemType}.md`);
    return this.resolveFile(fileRel);
  }

  /**
   * Resolve a system prompt for an item type, walking the profile inheritance
   * chain. Resolution order:
   *   1. prompts/_system.<itemType>.md
   *   2. prompts/_system.md
   *   3. "" (empty string — caller should treat as "no system prompt")
   *
   * Unlike `promptFor`, missing files do not throw; the empty string is a
   * legitimate result (a profile may simply not ship a system prompt).
   */
  async systemPromptFor(itemType: string): Promise<string> {
    const specific = path.posix.join("prompts", `_system.${itemType}.md`);
    const shared = path.posix.join("prompts", "_system.md");
    return (await this.tryResolveFile(specific)) ?? (await this.tryResolveFile(shared)) ?? "";
  }

  async resolveFile(fileRel: string): Promise<string> {
    const found = await this.tryResolveFile(fileRel);
    if (found !== null) return found;
    throw new Error(
      `File not found in profile chain ${this.opts.inheritanceChain.join(" -> ")}: ${fileRel}`,
    );
  }

  private async tryResolveFile(fileRel: string): Promise<string | null> {
    for (const root of this.opts.searchPaths) {
      const full = path.join(root, fileRel);
      try {
        return await fs.readFile(full, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    return null;
  }
}
