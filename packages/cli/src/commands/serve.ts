import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteProjectRepository, buildApp, migrate, openDb } from "@specgen/server";
import express from "express";

export interface ServeOptions {
  /** Override sqlite database path. Default: ~/.specgen/specgen.db */
  db?: string;
  /** Skip serving webapp static files (Vite handles it in dev mode). */
  dev?: boolean;
  /** Bind host. Default: SPECGEN_BIND_HOST or 127.0.0.1 */
  host?: string;
  /** Bind port. Default: SPECGEN_BIND_PORT or 6101 */
  port?: number;
}

export async function serveCommand(opts: ServeOptions = {}): Promise<void> {
  const host = opts.host ?? process.env.SPECGEN_BIND_HOST ?? "127.0.0.1";
  const port =
    opts.port ?? (process.env.SPECGEN_BIND_PORT ? Number(process.env.SPECGEN_BIND_PORT) : 6101);
  const dev = opts.dev ?? process.env.SPECGEN_DEV === "1";

  // Resolve the database path
  const defaultDb = path.join(homedir(), ".specgen", "specgen.db");
  const dbPath = path.resolve(opts.db ?? defaultDb);

  // Ensure the database directory exists
  mkdirSync(path.dirname(dbPath), { recursive: true });

  // Open sqlite + run migrations
  const db = openDb(dbPath);
  const migrationsDir = resolveMigrationsDir();
  migrate(db, migrationsDir);

  const projects = new SqliteProjectRepository(db);
  const packagedProfilesDir = resolvePackagedProfilesDir();
  const app = buildApp({ projects, packagedProfilesDir });

  // In production mode, serve the built webapp from packages/webapp/dist/
  if (!dev) {
    const webappDist = resolveWebappDist();
    try {
      app.use(express.static(webappDist));
      // SPA fallback — serve index.html for all unmatched GET routes
      app.get("*", (_req, res: express.Response) => {
        res.sendFile(path.join(webappDist, "index.html"));
      });
      process.stdout.write(`[specgen] serving webapp from ${webappDist}\n`);
    } catch {
      // Webapp not built yet — non-fatal in dev workflows
      process.stdout.write("[specgen] webapp dist not found — run `pnpm build` first\n");
    }
  }

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      process.stdout.write(`[specgen] listening on http://${host}:${port}\n`);
      if (dev) {
        process.stdout.write("[specgen] dev mode — webapp served by Vite on :6100\n");
      }
      resolve();
    });
    server.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Helpers — resolve paths that differ between tsx-dev and built dist layouts
// ---------------------------------------------------------------------------

function resolveMigrationsDir(): string {
  // When the CLI is built (dist/commands/serve.js), server's migrations live
  // next to its dist (packages/server/src/db/migrations in dev).
  // In the monorepo, both packages are siblings under packages/.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here = packages/cli/src/commands/ (dev) or packages/cli/dist/commands/ (built)
  const cliRoot = path.resolve(here, "..", "..");
  return path.resolve(cliRoot, "..", "server", "src", "db", "migrations");
}

function resolveWebappDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cliRoot = path.resolve(here, "..", "..");
  return path.resolve(cliRoot, "..", "webapp", "dist");
}

function resolvePackagedProfilesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cliRoot = path.resolve(here, "..", "..");
  return path.resolve(cliRoot, "..", "core", "profiles");
}

// ---------------------------------------------------------------------------
// Usage / help text
// ---------------------------------------------------------------------------

export function printServeUsage(): void {
  process.stdout.write(`specgen serve — boot the SpecGen API server

Usage:
  specgen serve [flags]

Flags:
  --db <path>    Path to sqlite database (default: ~/.specgen/specgen.db)
  --dev          Dev mode — skip serving webapp static files (Vite handles it)
  --host <host>  Bind host (default: SPECGEN_BIND_HOST or 127.0.0.1)
  --port <port>  Bind port (default: SPECGEN_BIND_PORT or 6101)
  --help         Show this help

Environment:
  SPECGEN_BIND_HOST   Bind host (default: 127.0.0.1)
  SPECGEN_BIND_PORT   Bind port (default: 6101)
  SPECGEN_DEV         Set to "1" to enable dev mode
`);
}
