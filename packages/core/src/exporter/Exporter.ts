import type { SpecRepository } from "../spec/SpecRepository.js";

// ---------------------------------------------------------------------------
// Context passed to every exporter run
// ---------------------------------------------------------------------------

export interface ExporterContext {
  spec: SpecRepository;
  output: NodeJS.WritableStream;
  format: string;
  options?: Record<string, unknown>;
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Streaming event shape
// ---------------------------------------------------------------------------

export type ExporterEvent =
  | { type: "progress"; message: string }
  | { type: "warning"; message: string }
  | { type: "error"; error: Error }
  | { type: "done" };

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export interface ExporterPlugin {
  /** Unique machine id, e.g. "markdown-item" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description of what this exporter produces */
  description: string;
  /** Output format ids this exporter supports, e.g. ["md"] or ["zip"] */
  supports_formats: readonly string[];

  /**
   * Execute the exporter.
   * Yields ExporterEvent values as work progresses.
   * The final event MUST be 'done' or 'error'.
   */
  run(ctx: ExporterContext): AsyncIterable<ExporterEvent>;
}
