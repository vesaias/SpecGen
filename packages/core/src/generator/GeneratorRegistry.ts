import type { GeneratorPlugin } from "./Generator.js";

/**
 * GeneratorRegistry — mirrors ParserRegistry.
 *
 * Maintains a map of registered GeneratorPlugin instances, keyed by id.
 * Rejects duplicate registrations.
 */
export class GeneratorRegistry {
  private readonly plugins = new Map<string, GeneratorPlugin>();

  register(plugin: GeneratorPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`GeneratorRegistry: duplicate plugin id "${plugin.id}"`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): GeneratorPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): GeneratorPlugin[] {
    return [...this.plugins.values()];
  }
}
