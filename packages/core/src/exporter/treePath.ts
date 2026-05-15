import type { TreeNode } from "../spec/types.js";

/**
 * Resolve the on-disk path for a SpecItem id by walking the sidebar tree.
 * Returns "<folder-slug>/.../<id>.md" or just "<id>.md" if the id has no
 * tree placement (orphan items). Folder slugs are lowercase, hyphen-only.
 *
 * Used by markdown-zip + DocsPushService to share the same layout
 * semantics; keep the two in lock-step by depending on this single function.
 */
export function pathForItem(tree: TreeNode[], id: string): string {
  const found = findInTree(tree, id, []);
  if (found) return [...found, `${id}.md`].join("/");
  return `${id}.md`;
}

function findInTree(nodes: TreeNode[], id: string, ancestry: string[]): string[] | null {
  for (const n of nodes) {
    if (n.type === "folder") {
      const folder = (n.label || n.id)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const childPath = [...ancestry, folder];
      if (n.children) {
        const found = findInTree(n.children, id, childPath);
        if (found) return found;
      }
    } else if (n.id === id) {
      return ancestry;
    }
  }
  return null;
}
