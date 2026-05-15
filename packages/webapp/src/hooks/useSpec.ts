import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSpec } from "../api";
import type { SpecItem, SpecJson, TreeNode } from "../types";

export interface UseSpecOptions {
  /** When provided, fetches from /api/projects/:slug/spec instead of /api/spec */
  projectSlug?: string;
}

export function useSpec(options: UseSpecOptions = {}) {
  const { projectSlug } = options;
  const [spec, setSpec] = useState<SpecJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLoading(true);
    setError(null);
    const loader = projectSlug
      ? fetch(`/api/projects/${encodeURIComponent(projectSlug)}/spec`).then((r) => {
          if (!r.ok) throw new Error(`Failed to load spec: ${r.statusText}`);
          return r.json();
        })
      : fetchSpec();
    loader
      .then((data) => {
        setSpec(data);
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [projectSlug]);

  const updateItem = useCallback(
    (id: string, updates: Partial<SpecItem>) => {
      setSpec((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: { ...prev.items, [id]: { ...prev.items[id], ...updates } as SpecItem },
        };
      });

      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const patchUrl = projectSlug
          ? `/api/projects/${encodeURIComponent(projectSlug)}/spec/item/${encodeURIComponent(id)}`
          : `/api/spec/item/${encodeURIComponent(id)}`;
        fetch(patchUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }).catch((err) => console.error("Save failed:", err));
      }, 800);
    },
    [projectSlug],
  );

  const updateTree = useCallback(
    (tree: TreeNode[]) => {
      setSpec((prev) => {
        if (!prev) return prev;
        return { ...prev, tree };
      });
      if (!projectSlug) {
        console.warn("Tree edits require a project context; skipping save");
        return;
      }
      fetch(`/api/projects/${encodeURIComponent(projectSlug)}/spec/tree`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tree }),
      }).catch((err) => console.error("Tree save failed:", err));
    },
    [projectSlug],
  );

  useEffect(() => {
    return () => clearTimeout(saveTimer.current);
  }, []);

  return { spec, loading, error, updateItem, updateTree };
}
