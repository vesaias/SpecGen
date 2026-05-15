import type { ExporterPlugin } from "../Exporter.js";
import { renderItemMarkdown } from "../markdownItemRenderers.js";

/**
 * markdownItemExporter — renders a single SpecItem to a Markdown file via stream.
 *
 * Requires options.itemId to identify which item to export.
 */
export const markdownItemExporter: ExporterPlugin = {
  id: "markdown-item",
  name: "Markdown (single item)",
  description: "Renders one SpecItem to a Markdown file via stream.",
  supports_formats: ["md"],

  async *run(ctx) {
    const itemId = String(ctx.options?.itemId ?? "");
    if (!itemId) {
      yield { type: "error", error: new Error("options.itemId required") };
      return;
    }
    const item = await ctx.spec.readItem(itemId);
    if (!item) {
      yield { type: "error", error: new Error(`Item not found: ${itemId}`) };
      return;
    }
    ctx.output.write(renderItemMarkdown(item));
    yield { type: "done" };
  },
};
