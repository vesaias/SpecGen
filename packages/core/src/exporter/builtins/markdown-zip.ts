import * as archiverNs from "archiver";
import type archiver from "archiver";
import type { Spec, SpecItem, TreeNode } from "../../spec/types.js";
import type { ExporterPlugin } from "../Exporter.js";
import { renderItemMarkdown } from "../markdownItemRenderers.js";
import { pathForItem } from "../treePath.js";

// archiver v8 is ESM and exports ZipArchive as a named class. @types/archiver
// still reflects the v5/v6 shape (factory function), so we cast through unknown
// to reach the runtime export without fighting stale type declarations.
const ZipArchiveClass = (archiverNs as unknown as Record<string, unknown>).ZipArchive as new (
  opts?: archiver.ArchiverOptions,
) => archiver.Archiver;

/**
 * markdownZipExporter — renders the entire spec as a zip of Markdown files.
 *
 * Directory layout mirrors the spec tree:
 *   README.md           — project summary + TOC
 *   backend/get-foo.md  — one file per item, in tree-mirrored folders
 */
export const markdownZipExporter: ExporterPlugin = {
  id: "markdown-zip",
  name: "Markdown zip",
  description: "Zip of the full spec rendered as Markdown, tree-mirrored.",
  supports_formats: ["zip"],

  async *run(ctx) {
    const snap = await ctx.spec.snapshot();
    yield {
      type: "progress",
      message: `Snapshot of ${Object.keys(snap.items).length} items`,
    };

    const zip = new ZipArchiveClass({ zlib: { level: 9 } });

    // Surface archiver errors and output-stream errors as typed events so
    // callers can handle them rather than receiving an unhandled rejection.
    let archiverError: Error | undefined;
    zip.on("error", (err: Error) => {
      archiverError = err;
    });
    (ctx.output as NodeJS.EventEmitter).on("error", (err: Error) => {
      archiverError = err;
    });

    zip.pipe(ctx.output);

    zip.append(renderRootReadme(snap.spec, snap.items), { name: "README.md" });

    for (const [id, item] of Object.entries(snap.items)) {
      if (archiverError) {
        yield { type: "error" as const, error: archiverError };
        return;
      }
      const filePath = pathForItem(snap.spec.tree, id);
      zip.append(renderItemMarkdown(item), { name: filePath });
      yield { type: "progress", message: `Wrote ${filePath}` };
    }

    try {
      await zip.finalize();
    } catch (err) {
      yield { type: "error" as const, error: err instanceof Error ? err : new Error(String(err)) };
      return;
    }

    if (archiverError) {
      yield { type: "error" as const, error: archiverError };
      return;
    }

    yield { type: "done" };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a README.md with project metadata and a linked table of contents.
 */
function renderRootReadme(spec: Spec, items: Record<string, SpecItem>): string {
  const lines: string[] = [];
  lines.push(`# ${spec.meta.target}`);
  lines.push("");
  lines.push(`Generated: ${spec.meta.generatedAt}`);
  lines.push(`Version: ${spec.meta.version}`);
  lines.push("");
  lines.push(`Items: ${Object.keys(items).length}`);
  lines.push("");

  function walk(nodes: TreeNode[], depth: number): void {
    for (const n of nodes) {
      const indent = "  ".repeat(depth);
      if (n.type === "folder") {
        lines.push(`${indent}- **${n.label ?? n.id}**`);
        if (n.children) walk(n.children, depth + 1);
      } else {
        const item = items[n.id];
        if (!item) continue;
        const filePath = pathForItem(spec.tree, n.id);
        lines.push(`${indent}- [${item.title}](${filePath})`);
      }
    }
  }
  walk(spec.tree, 0);

  return `${lines.join("\n")}\n`;
}
