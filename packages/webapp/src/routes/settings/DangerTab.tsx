import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { projectsApi } from "../../api/client.js";
import { Button } from "../../components/ui/Button.js";

export function DangerTab() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    projectsApi.get(slug).then(setProject);
  }, [slug]);

  if (!project) return <div className="text-stone-500 dark:text-stone-400">Loading…</div>;

  const canDelete = confirmText === project.slug;

  async function handleDelete() {
    if (!slug || !canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await projectsApi.delete(slug);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-medium mb-4 text-red-600 dark:text-red-400">Danger zone</h2>
      <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 rounded p-4">
        <h3 className="font-medium text-red-900 dark:text-red-200 mb-2">Delete project</h3>
        <p className="text-sm text-red-800 dark:text-red-300 mb-4">
          This deletes the project record from SpecGen's database. The source code on disk is not
          touched. Spec content under{" "}
          <code className="font-mono bg-red-100 dark:bg-red-900 px-1">.specgen/data</code> at the
          project's local path is also untouched — you can reconnect later by creating a new project
          at the same path.
        </p>
        <p className="text-sm text-red-800 dark:text-red-300 mb-2">
          Type <code className="font-mono bg-red-100 dark:bg-red-900 px-1">{project.slug}</code> to
          confirm:
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="w-full px-3 py-2 border border-red-300 dark:border-red-800 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded font-mono text-sm mb-3"
          placeholder={project.slug}
        />
        {error && <div className="text-sm text-red-700 dark:text-red-300 mb-2">{error}</div>}
        <Button variant="danger" disabled={!canDelete || deleting} onClick={handleDelete}>
          {deleting ? "Deleting…" : "Delete project"}
        </Button>
      </div>
    </div>
  );
}
