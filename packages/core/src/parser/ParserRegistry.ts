import type { ParserFileSystem } from "./FileSystem.js";
import type { ParserPlugin } from "./Parser.js";

export class ParserRegistry {
  private readonly plugins = new Map<string, ParserPlugin>();

  register(plugin: ParserPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`ParserRegistry: duplicate plugin id "${plugin.id}"`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): ParserPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): ParserPlugin[] {
    return [...this.plugins.values()];
  }

  async detectAll(
    rootDir: string,
    fs: ParserFileSystem,
  ): Promise<{ plugin: ParserPlugin; confidence: number; subDirs: string[] }[]> {
    const results = await Promise.all(
      this.list().map(async (plugin) => {
        const r = await plugin.detect({ rootDir, fs });
        return { plugin, confidence: r.confidence, subDirs: r.subDirs };
      }),
    );
    return results.filter((r) => r.confidence > 0).sort((a, b) => b.confidence - a.confidence);
  }
}
