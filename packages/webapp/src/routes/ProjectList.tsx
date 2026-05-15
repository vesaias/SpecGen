import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { projectsApi } from "../api/client.js";
import { AppShell } from "../components/ui/AppShell.js";
import { Button } from "../components/ui/Button.js";

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    projectsApi.list().then(setProjects);
  }, []);

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(filter.toLowerCase()) || p.slug.includes(filter.toLowerCase()),
  );

  return (
    <AppShell
      maxWidth="screen-2xl"
      right={
        <Link to="/projects/new">
          <Button variant="primary" size="md">
            + New
          </Button>
        </Link>
      }
    >
      <header className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">All projects</h1>
      </header>
      <input
        type="text"
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded mb-4"
      />
      <table className="w-full text-sm">
        <thead className="text-left text-stone-500 dark:text-stone-500 border-b border-stone-200 dark:border-stone-800">
          <tr>
            <th className="py-2">Name</th>
            <th>Slug</th>
            <th>Source</th>
            <th>Last parsed</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr
              key={p.id}
              className="border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-900"
            >
              <td className="py-2">
                <Link
                  to={`/projects/${p.slug}`}
                  className="font-medium text-stone-900 dark:text-stone-100"
                >
                  {p.name}
                </Link>
              </td>
              <td className="text-stone-500 dark:text-stone-400">{p.slug}</td>
              <td className="text-stone-500 dark:text-stone-400">{p.source.type}</td>
              <td className="text-stone-500 dark:text-stone-400">
                {p.lastParsedAt ? new Date(p.lastParsedAt).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}
