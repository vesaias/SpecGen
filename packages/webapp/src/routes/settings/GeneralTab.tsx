import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { projectsApi } from "../../api/client.js";
import { Button } from "../../components/ui/Button.js";

export function GeneralTab() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) return;
    projectsApi.get(slug).then((p) => {
      setProject(p);
      setName(p.name);
      setDescription(p.description ?? "");
      setIcon(p.icon ?? "");
    });
  }, [slug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await projectsApi.update(slug, {
        name,
        description: description || null,
        icon: icon || null,
      });
      setProject(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!project) return <div className="text-stone-500 dark:text-stone-400">Loading…</div>;

  return (
    <div>
      <h2 className="text-lg font-medium mb-4 text-stone-900 dark:text-stone-100">General</h2>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded"
          />
        </div>
        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded"
          />
        </div>
        <div>
          <label
            htmlFor="icon"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Icon
          </label>
          <input
            id="icon"
            type="text"
            placeholder="📦 (emoji or short label)"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded"
          />
        </div>
        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {savedAt && <span className="text-sm text-stone-500 dark:text-stone-400">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
