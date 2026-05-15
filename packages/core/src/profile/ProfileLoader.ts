import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ResolvedProfile } from "./Profile.js";
import { type ProfileManifest, profileManifestSchema } from "./profileSchema.js";

export interface ProfileLoaderOptions {
  packagedRoot: string; // absolute path to packaged profiles dir
}

export interface ProfileSummary {
  id: string;
  name: string;
  description?: string;
  source: "packaged" | "project";
}

export class ProfileLoader {
  constructor(private readonly opts: ProfileLoaderOptions) {}

  async list(): Promise<ProfileSummary[]> {
    const dirs = await safeReaddir(this.opts.packagedRoot);
    const out: ProfileSummary[] = [];
    for (const dir of dirs) {
      const manifestPath = path.join(this.opts.packagedRoot, dir, "profile.yaml");
      const manifest = await this.tryReadManifest(manifestPath);
      if (manifest) {
        out.push({
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          source: "packaged",
        });
      }
    }
    return out;
  }

  async load(id: string, projectRoot?: string): Promise<ResolvedProfile> {
    const chain = await this.resolveChain(id, projectRoot);
    const manifest = chain[0]?.manifest;
    if (!manifest) throw new Error(`Profile not found: ${id}`);
    const inheritanceChain = chain.map((c) => c.manifest.id);
    const searchPaths: string[] = [];
    if (projectRoot) {
      // Project-level overrides come first for every link in the chain (child override first).
      for (const link of chain) {
        searchPaths.push(path.join(projectRoot, ".specgen", "profiles", link.manifest.id));
      }
    }
    for (const link of chain) {
      searchPaths.push(link.dir);
    }
    return new ResolvedProfile({ manifest, inheritanceChain, searchPaths });
  }

  private async resolveChain(
    id: string,
    projectRoot?: string,
  ): Promise<{ manifest: ProfileManifest; dir: string }[]> {
    const seen = new Set<string>();
    const chain: { manifest: ProfileManifest; dir: string }[] = [];
    let current: string | null = id;
    while (current) {
      if (seen.has(current)) {
        throw new Error(`Circular extends detected: ${[...seen, current].join(" -> ")}`);
      }
      seen.add(current);
      const link = await this.findManifest(current, projectRoot);
      if (!link) throw new Error(`Profile not found: ${current}`);
      chain.push(link);
      current = link.manifest.extends;
    }
    return chain;
  }

  private async findManifest(
    id: string,
    projectRoot?: string,
  ): Promise<{ manifest: ProfileManifest; dir: string } | null> {
    const candidates: string[] = [];
    if (projectRoot) candidates.push(path.join(projectRoot, ".specgen", "profiles", id));
    candidates.push(path.join(this.opts.packagedRoot, id));
    for (const dir of candidates) {
      const manifestPath = path.join(dir, "profile.yaml");
      const manifest = await this.tryReadManifest(manifestPath);
      if (manifest) return { manifest, dir };
    }
    return null;
  }

  private async tryReadManifest(p: string): Promise<ProfileManifest | null> {
    try {
      const raw = await fs.readFile(p, "utf8");
      const parsed = YAML.parse(raw) as unknown;
      return profileManifestSchema.parse(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
