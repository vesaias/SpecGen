import type { ExporterPlugin } from "./Exporter.js";

/**
 * ExporterRegistry — mirrors GeneratorRegistry.
 *
 * Maintains a map of registered ExporterPlugin instances, keyed by id.
 * Rejects duplicate registrations.
 */
export class ExporterRegistry {
  private readonly plugins = new Map<string, ExporterPlugin>();

  register(p: ExporterPlugin): void {
    if (this.plugins.has(p.id)) {
      throw new Error(`ExporterRegistry: duplicate plugin id "${p.id}"`);
    }
    this.plugins.set(p.id, p);
  }

  get(id: string): ExporterPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): ExporterPlugin[] {
    return [...this.plugins.values()];
  }
}
