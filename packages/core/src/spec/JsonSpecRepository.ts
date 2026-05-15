import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SpecRepository, SpecSnapshot } from "./SpecRepository.js";
import type { Spec, SpecItem, TreeNode } from "./types.js";

/** Regex for valid item ids — prevents path traversal attacks */
const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * JsonSpecRepository — stores spec data as JSON files on disk.
 *
 * Filesystem layout:
 * ```
 * <dataDir>/
 *   spec.json          # { meta, tree, items: { id: stub } }
 *   items/
 *     <id>.json        # full item with all fields
 * ```
 *
 * Uses atomic writes (write to `.tmp` → rename) to avoid corruption on crash.
 */
export class JsonSpecRepository implements SpecRepository {
  private readonly specPath: string;
  private readonly itemsDir: string;

  constructor(private readonly dataDir: string) {
    this.specPath = path.join(dataDir, "spec.json");
    this.itemsDir = path.join(dataDir, "items");
  }

  // ---------------------------------------------------------------------------
  // Spec document
  // ---------------------------------------------------------------------------

  async read(): Promise<Spec | null> {
    if (!existsSync(this.specPath)) return null;
    try {
      const raw = await readFile(this.specPath, "utf8");
      return JSON.parse(raw) as Spec;
    } catch {
      return null;
    }
  }

  async write(spec: Spec): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await atomicWrite(this.specPath, JSON.stringify(spec, null, 2));
  }

  // ---------------------------------------------------------------------------
  // Individual items
  // ---------------------------------------------------------------------------

  async readItem(id: string): Promise<SpecItem | null> {
    validateId(id);
    const p = path.join(this.itemsDir, `${id}.json`);
    if (!existsSync(p)) return null;
    try {
      const raw = await readFile(p, "utf8");
      return JSON.parse(raw) as SpecItem;
    } catch {
      return null;
    }
  }

  async writeItem(item: SpecItem): Promise<void> {
    validateId(item.id);
    await mkdir(this.itemsDir, { recursive: true });
    const p = path.join(this.itemsDir, `${item.id}.json`);
    await atomicWrite(p, JSON.stringify(item, null, 2));
  }

  async deleteItem(id: string): Promise<void> {
    validateId(id);
    const p = path.join(this.itemsDir, `${id}.json`);
    try {
      await rm(p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // ENOENT → no-op (delete is idempotent)
    }
  }

  async listItemIds(): Promise<string[]> {
    if (!existsSync(this.itemsDir)) return [];
    const entries = await readdir(this.itemsDir);
    return entries
      .filter((e) => e.endsWith(".json"))
      .map((e) => e.slice(0, -5)) // strip .json
      .sort();
  }

  async snapshot(): Promise<SpecSnapshot> {
    const spec = await this.read();
    if (!spec) throw new Error(`No spec at ${this.specPath}`);
    const ids = await this.listItemIds();
    const items: Record<string, SpecItem> = {};
    // tolerate ENOENT / malformed JSON on individual items (a concurrent run may
    // have deleted them mid-iteration). readItem already returns null on either.
    await Promise.all(
      ids.map(async (id) => {
        const item = await this.readItem(id);
        if (item) items[id] = item;
      }),
    );
    const pruned = pruneTreeToItems(spec.tree, items);
    return { spec: { ...spec, tree: pruned }, items };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateId(id: string): void {
  if (!VALID_ID.test(id)) {
    throw new Error(
      `Invalid item id "${id}" — must match [a-z0-9][a-z0-9-]*. Path traversal is not allowed.`,
    );
  }
}

function pruneTreeToItems(tree: TreeNode[], items: Record<string, SpecItem>): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of tree) {
    if (node.type === "folder") {
      const children = pruneTreeToItems(node.children ?? [], items);
      if (children.length > 0) out.push({ ...node, children });
    } else if (items[node.id]) {
      out.push(node);
    }
  }
  return out;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}
