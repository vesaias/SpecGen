import type { SpecItem, SpecJson } from "./types";

const BASE = "/api";

export async function fetchSpec(): Promise<SpecJson> {
  const res = await fetch(`${BASE}/spec`);
  if (!res.ok) throw new Error(`Failed to load spec: ${res.statusText}`);
  return res.json();
}

export async function patchItem(id: string, data: Partial<SpecItem>): Promise<SpecItem> {
  const res = await fetch(`${BASE}/spec/item/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to patch item: ${res.statusText}`);
  return res.json();
}
