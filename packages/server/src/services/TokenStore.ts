import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Db } from "../db/sqlite.js";

/**
 * Logical scope a token belongs to. `projectId` may be `null` for server-wide
 * tokens (none today, but the column allows it).
 */
export interface TokenScope {
  projectId: string | null;
  provider: string;
}

/**
 * Discriminated union of the connector-specific token payloads we encrypt.
 * Persisted as JSON inside the ciphertext blob.
 */
export type TokenValue =
  | { provider: "github"; token: string; scopes?: string[] }
  | { provider: "confluence"; baseUrl: string; email: string; apiToken: string }
  /**
   * Capture-auth credentials for the frontend-capture generator. The shape is
   * intentionally permissive (any of the four secret-bearing auth modes the
   * package supports) — what we persist is whatever the Capture settings tab
   * sent us. The capture API route is the only consumer; it reads this value
   * and merges it into the CaptureConfig at run time so plaintext secrets
   * never live in `project.connectors.capture`.
   */
  | {
      provider: "capture-auth";
      /** Mirrors CaptureAuth from @specgen/parser-frontend-capture. */
      auth:
        | {
            type: "cookie";
            cookies: Array<{ name: string; value: string; domain?: string; path?: string }>;
          }
        | { type: "header"; headers: Record<string, string> }
        | { type: "basic"; username: string; password: string }
        | {
            type: "form";
            loginUrl: string;
            usernameSelector: string;
            passwordSelector: string;
            submitSelector: string;
            usernameValue: string;
            passwordValue: string;
            postLoginUrlContains?: string;
          }
        | { type: "localStorage"; entries: Array<{ key: string; value: string }> };
    };

/**
 * What `list()` returns — never includes plaintext token material.
 */
export interface RedactedToken {
  provider: string;
  label?: string;
  last4?: string;
  createdAt: string;
  lastUsedAt?: string;
}

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_VERSION = 1;

/**
 * Build the additional-authenticated-data string. Binding (projectId, provider,
 * keyVersion) into the AAD means a swapped ciphertext from another row will
 * fail to decrypt — without changing the SQL surface area.
 */
function aadFor(scope: TokenScope, keyVersion: number): Buffer {
  return Buffer.from(`${scope.projectId ?? ""}:${scope.provider}:${keyVersion}`, "utf8");
}

/**
 * AES-256-GCM encrypted token storage backed by the `connector_tokens` table.
 *
 * Crypto:
 *  - 32-byte master key (supplied by `resolveMasterKey`)
 *  - 12-byte random IV per write
 *  - AAD = "<projectId>:<provider>:<keyVersion>" so rows can't be swapped
 *  - 16-byte auth tag stored alongside ciphertext
 *
 * The `list()` view never decrypts; it returns only display-safe fields.
 */
export class TokenStore {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) {
      throw new Error("TokenStore key must be 32 bytes");
    }
  }

  async set(scope: TokenScope, value: TokenValue, label?: string): Promise<void> {
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const iv = randomBytes(IV_LEN);
    const aad = aadFor(scope, KEY_VERSION);
    const cipher = createCipheriv(ALGO, this.key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Derive last4 from whichever field holds the secret, for redacted display.
    const last4 =
      "token" in value
        ? value.token.slice(-4)
        : "apiToken" in value
          ? value.apiToken.slice(-4)
          : "";

    const now = new Date().toISOString();
    const id = `tok_${randomBytes(8).toString("hex")}`;

    this.db
      .prepare(
        `INSERT INTO connector_tokens
           (id, project_id, connector_id, ciphertext, iv, auth_tag, label, last4, created_at, key_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_id, connector_id) DO UPDATE
           SET ciphertext = excluded.ciphertext,
               iv = excluded.iv,
               auth_tag = excluded.auth_tag,
               label = excluded.label,
               last4 = excluded.last4,
               key_version = excluded.key_version`,
      )
      .run(
        id,
        scope.projectId,
        scope.provider,
        ciphertext,
        iv,
        authTag,
        label ?? null,
        last4,
        now,
        KEY_VERSION,
      );
  }

  async get(scope: TokenScope): Promise<TokenValue | null> {
    const row = this.db
      .prepare(
        `SELECT ciphertext, iv, auth_tag, key_version
           FROM connector_tokens
          WHERE project_id IS ? AND connector_id = ?`,
      )
      .get(scope.projectId, scope.provider) as
      | { ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; key_version: number }
      | undefined;
    if (!row) return null;

    const aad = aadFor(scope, row.key_version);
    const decipher = createDecipheriv(ALGO, this.key, row.iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(row.auth_tag);
    const plaintext = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString(
      "utf8",
    );

    // Successful decrypt — record the access. Done after decrypt so failed
    // attempts (wrong key, tampered row) don't update timestamps.
    this.db
      .prepare(
        `UPDATE connector_tokens SET last_used_at = ?
          WHERE project_id IS ? AND connector_id = ?`,
      )
      .run(new Date().toISOString(), scope.projectId, scope.provider);

    return JSON.parse(plaintext) as TokenValue;
  }

  async delete(scope: TokenScope): Promise<boolean> {
    const r = this.db
      .prepare("DELETE FROM connector_tokens WHERE project_id IS ? AND connector_id = ?")
      .run(scope.projectId, scope.provider);
    return r.changes > 0;
  }

  async list(projectId: string | null): Promise<RedactedToken[]> {
    const rows = this.db
      .prepare(
        `SELECT connector_id, label, last4, created_at, last_used_at
           FROM connector_tokens
          WHERE project_id IS ?
          ORDER BY created_at`,
      )
      .all(projectId) as Array<{
      connector_id: string;
      label: string | null;
      last4: string | null;
      created_at: string;
      last_used_at: string | null;
    }>;
    return rows.map((r) => ({
      provider: r.connector_id,
      label: r.label ?? undefined,
      last4: r.last4 ?? undefined,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at ?? undefined,
    }));
  }
}
