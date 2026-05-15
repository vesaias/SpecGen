import { useMemo } from "react";
import type { SpecJson } from "../types";

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  type: "backend" | "frontend" | "event";
}

export function useSearch(spec: SpecJson | null): SearchResult[] {
  return useMemo(() => {
    if (!spec) return [];
    return Object.entries(spec.items).map(([id, item]) => {
      let subtitle = "";
      if (item.type === "backend") subtitle = item.route;
      else if (item.type === "frontend") subtitle = item.route;
      else if (item.type === "event" || item.type === "handler") subtitle = item.summary || "";
      const type = item.type === "handler" ? "event" : item.type;
      return { id, title: item.title, subtitle, type };
    });
  }, [spec]);
}
