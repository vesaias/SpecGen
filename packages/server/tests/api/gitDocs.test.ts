import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/api/app.js";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import { GitDocsStateRepository } from "../../src/repositories/GitDocsStateRepository.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";
import { TokenStore } from "../../src/services/TokenStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");

// ---------------------------------------------------------------------------
// Fake DocsPushService that blocks until `releaseCurrentPush()` is called.
// Lets us hold a push in-flight while firing a second request to verify the
// 409 concurrent-push guard fires correctly.
// ---------------------------------------------------------------------------

// A shared latch: the mock calls `entered()` when it has started executing,
// and blocks until `releaseCurrentPush()` is invoked from outside.
let enteredResolve: (() => void) | null = null;
let enteredPromise: Promise<void> | null = null;
let releaseCurrentPush: (() => void) | null = null;

vi.mock("@specgen/connector-git-docs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@specgen/connector-git-docs")>();
  return {
    ...original,
    DocsPushService: class FakeDocsPushService {
      async run() {
        // Signal that we've entered the mock.
        enteredResolve?.();
        // Block until the test releases us.
        await new Promise<void>((resolve) => {
          releaseCurrentPush = resolve;
        });
        return { pushedSha: "abc123", filesWritten: 1 };
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

function buildTestApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-gitdocs-api-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS_DIR);
  const projects = new SqliteProjectRepository(db);
  const gitDocsState = new GitDocsStateRepository(db);
  const tokens = new TokenStore(db, Buffer.alloc(32, "k"));
  const app = buildApp({ projects, packagedProfilesDir: PACKAGED_PROFILES, tokens, gitDocsState });
  return { app, projects, tokens };
}

/** Create a project with gitDocs connector config and a stored GitHub token. */
async function createProjectWithToken(
  app: ReturnType<typeof buildTestApp>["app"],
  projects: SqliteProjectRepository,
  tokens: TokenStore,
): Promise<string> {
  const createRes = await request(app)
    .post("/api/projects")
    .send({
      name: "Git Docs Test Project",
      source: { type: "local", localPath: tmpdir() },
    });
  expect(createRes.status).toBe(201);
  const { slug } = createRes.body as { slug: string };

  // Patch connector config via the repository update method.
  projects.update(slug, {
    connectors: { gitDocs: { cloneUrl: "file:///tmp/fake-repo" } },
  });

  const project = projects.findBySlug(slug);
  if (!project) throw new Error("project not found after update");

  await tokens.set(
    { projectId: project.id, provider: "github" },
    { provider: "github", token: "ghp_fake" },
  );

  return slug;
}

describe("POST /api/v0/projects/:slug/git-docs/push — concurrent-push mutex", () => {
  beforeEach(() => {
    releaseCurrentPush = null;
    enteredResolve = null;
    enteredPromise = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
  });

  it("returns 409 when a push is already in-flight for the same project", async () => {
    const { app, projects, tokens } = buildTestApp();
    const slug = await createProjectWithToken(app, projects, tokens);

    // Fire the first push — it will block inside FakeDocsPushService.run().
    // No Origin header → requireSameOrigin allows (CLI / supertest style).
    // Call .then() explicitly so supertest starts the request immediately
    // without us awaiting it yet. We hold the promise for later inspection.
    const firstPushPromise = new Promise<import("supertest").Response>((resolve, reject) => {
      request(app).post(`/api/v0/projects/${slug}/git-docs/push`).then(resolve, reject);
    });

    // Wait until the mock signals it has entered (i.e., push is registered
    // in inflightPushes) before firing the second request.
    await enteredPromise;

    // Fire the second push while the first is still held.
    const secondRes = await request(app).post(`/api/v0/projects/${slug}/git-docs/push`);

    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error).toMatch(/already in progress/i);

    // Release the first push and verify it completes successfully.
    releaseCurrentPush?.();
    const firstRes = await firstPushPromise;
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.ok).toBe(true);
  }, 10_000); // 10 s timeout — the first request is intentionally blocking
});
