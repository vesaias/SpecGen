import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Resolve the AES-256 master key used by TokenStore to encrypt connector tokens.
 *
 * Order of resolution:
 *   1. SPECGEN_SECRET_KEY env var (base64, exactly 32 bytes after decode)
 *   2. <dataDir>/secret.key on disk (base64, exactly 32 bytes after decode)
 *   3. Otherwise: generate a fresh 32-byte key, write it (0600 on POSIX) and log a one-time warning.
 *
 * Losing this key makes all stored ciphertexts unrecoverable. The generation
 * branch logs to stdout so operators see it once and can back the file up.
 */
export function resolveMasterKey(dataDir: string): Buffer {
  const env = process.env.SPECGEN_SECRET_KEY;
  if (env) {
    const raw = env.trim();
    if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
      throw new Error("SPECGEN_SECRET_KEY must be base64-encoded 32 bytes (invalid characters)");
    }
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("SPECGEN_SECRET_KEY must be 32 bytes (base64)");
    return buf;
  }
  const filePath = path.join(dataDir, "secret.key");
  if (existsSync(filePath)) {
    const buf = Buffer.from(readFileSync(filePath, "utf8").trim(), "base64");
    if (buf.length !== 32) {
      throw new Error(`Corrupt key at ${filePath}; expected 32 bytes (base64)`);
    }
    return buf;
  }
  mkdirSync(dataDir, { recursive: true });
  const generated = randomBytes(32);
  try {
    writeFileSync(filePath, generated.toString("base64"), {
      encoding: "utf8",
      flag: "wx", // exclusive create — fails if file already exists (race-safe)
      mode: 0o600, // folds chmod into the write on POSIX
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Lost the race — another process just generated; read theirs.
      const buf = Buffer.from(readFileSync(filePath, "utf8").trim(), "base64");
      if (buf.length !== 32)
        throw new Error(`Corrupt key at ${filePath}; expected 32 bytes (base64)`);
      return buf;
    }
    throw err;
  }
  try {
    chmodSync(filePath, 0o600);
  } catch {
    /* windows */
  }
  process.stdout.write(
    `[specgen] generated master key at ${filePath} — back this up; losing it makes all stored tokens unrecoverable\n`,
  );
  return generated;
}
