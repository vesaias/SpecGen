import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/migrate.js";
import { type Db, openDb } from "../db/sqlite.js";
import { TokenStore } from "./TokenStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../db/migrations");

function makeDb(): Db {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-tokenstore-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS_DIR);
  // connector_tokens.project_id has a FK to projects(id); seed the project rows
  // the tests reference so inserts don't trip the constraint.
  const insert = db.prepare(
    "INSERT INTO projects (id, slug, name, source_type, source_config_json) VALUES (?, ?, ?, 'local', '{}')",
  );
  insert.run("p1", "p1", "p1");
  insert.run("p2", "p2", "p2");
  return db;
}

describe("TokenStore", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips a github token through encrypt + decrypt", async () => {
    const store = new TokenStore(makeDb(), key);
    await store.set(
      { projectId: "p1", provider: "github" },
      { provider: "github", token: "ghp_xyz" },
      "Main repo",
    );
    expect(await store.get({ projectId: "p1", provider: "github" })).toEqual({
      provider: "github",
      token: "ghp_xyz",
    });
  });

  it("round-trips a confluence token + base url", async () => {
    const store = new TokenStore(makeDb(), key);
    await store.set(
      { projectId: "p1", provider: "confluence" },
      {
        provider: "confluence",
        baseUrl: "https://acme.atlassian.net/wiki",
        email: "x@y",
        apiToken: "atc_abc",
      },
    );
    const got = await store.get({ projectId: "p1", provider: "confluence" });
    expect(got).toEqual({
      provider: "confluence",
      baseUrl: "https://acme.atlassian.net/wiki",
      email: "x@y",
      apiToken: "atc_abc",
    });
  });

  it("list returns redacted entries only, never plaintext", async () => {
    const store = new TokenStore(makeDb(), key);
    await store.set(
      { projectId: "p1", provider: "github" },
      { provider: "github", token: "ghp_abcd1234" },
      "x",
    );
    const list = await store.list("p1");
    expect(list).toHaveLength(1);
    const entry = list[0];
    expect(entry?.last4).toBe("1234");
    expect(entry?.provider).toBe("github");
    // critical: list values must NOT include the plaintext token
    expect(JSON.stringify(list)).not.toContain("ghp_abcd1234");
  });

  it("get returns null for an unknown scope", async () => {
    const store = new TokenStore(makeDb(), key);
    expect(await store.get({ projectId: "missing", provider: "github" })).toBeNull();
  });

  it("delete removes the row + returns true; second delete returns false", async () => {
    const store = new TokenStore(makeDb(), key);
    await store.set(
      { projectId: "p1", provider: "github" },
      { provider: "github", token: "ghp_xyz" },
    );
    expect(await store.delete({ projectId: "p1", provider: "github" })).toBe(true);
    expect(await store.get({ projectId: "p1", provider: "github" })).toBeNull();
    expect(await store.delete({ projectId: "p1", provider: "github" })).toBe(false);
  });

  it("upsert behavior: set twice overwrites the previous token", async () => {
    const store = new TokenStore(makeDb(), key);
    await store.set(
      { projectId: "p1", provider: "github" },
      { provider: "github", token: "ghp_v1" },
    );
    await store.set(
      { projectId: "p1", provider: "github" },
      { provider: "github", token: "ghp_v2" },
    );
    expect(await store.get({ projectId: "p1", provider: "github" })).toEqual({
      provider: "github",
      token: "ghp_v2",
    });
  });

  it("AAD binds ciphertext to (project_id, provider, key_version); tampering throws", async () => {
    const db = makeDb();
    const store = new TokenStore(db, key);
    await store.set(
      { projectId: "p1", provider: "github" },
      { provider: "github", token: "ghp_a" },
    );
    await store.set(
      { projectId: "p2", provider: "github" },
      { provider: "github", token: "ghp_b" },
    );
    // Swap ciphertext+iv+auth_tag of p1 onto p2's row — should fail decrypt because AAD differs
    const p1 = db
      .prepare(
        "SELECT ciphertext, iv, auth_tag FROM connector_tokens WHERE project_id = 'p1' AND connector_id = 'github'",
      )
      .get() as { ciphertext: Buffer; iv: Buffer; auth_tag: Buffer };
    db.prepare(
      "UPDATE connector_tokens SET ciphertext=?, iv=?, auth_tag=? WHERE project_id='p2' AND connector_id='github'",
    ).run(p1.ciphertext, p1.iv, p1.auth_tag);
    await expect(store.get({ projectId: "p2", provider: "github" })).rejects.toThrow();
  });

  it("wrong master key throws on decrypt", async () => {
    const db = makeDb();
    const store1 = new TokenStore(db, Buffer.alloc(32, 7));
    await store1.set(
      { projectId: "p1", provider: "github" },
      { provider: "github", token: "ghp_xyz" },
    );
    const store2 = new TokenStore(db, Buffer.alloc(32, 9)); // different key
    await expect(store2.get({ projectId: "p1", provider: "github" })).rejects.toThrow();
  });
});
