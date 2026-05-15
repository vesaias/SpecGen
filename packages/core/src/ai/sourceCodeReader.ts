/**
 * readSourceCode — read a set of source files relative to a root directory
 * and concatenate them into a single string suitable for embedding in an
 * AI prompt.
 *
 * Each surviving file becomes one entry shaped like:
 *
 *   // FILE: <rel>
 *   <body>
 *
 * Entries are separated by a blank line. Two budgets bound the output:
 *  - perFileBytes: cap on bytes kept from any single file (default 64 KiB).
 *  - totalBytes:   cap on bytes of *content* across all entries combined
 *                  (default 256 KiB). The "FILE:" header lines and the
 *                  truncation marker are not counted toward this budget;
 *                  we cap the raw source bodies.
 *
 * When a single file exceeds perFileBytes, the kept portion is followed by
 *   // ...truncated (<N> more bytes)
 * where N is the number of bytes that were dropped.
 *
 * Files that are missing, are directories, or otherwise unreadable are
 * silently skipped — readSourceCode never throws for bad inputs. This is
 * intentional: callers (AI enrichment) prefer a partial prompt to a hard
 * failure.
 *
 * The function is synchronous on purpose. It runs once per AI call and the
 * code paths around it are already async-heavy; keeping this leaf simple
 * makes it easier to reason about under cancellation.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ReadSourceCodeOpts {
  /** Cap per file in bytes. Default 64 KB. */
  perFileBytes?: number;
  /** Cap across all files combined in bytes. Default 256 KB. */
  totalBytes?: number;
}

const DEFAULT_PER_FILE_BYTES = 64 * 1024;
const DEFAULT_TOTAL_BYTES = 256 * 1024;

/** Trim a Buffer to the last complete UTF-8 codepoint boundary. */
function trimToCodepointBoundary(buf: Buffer, byteLimit: number): Buffer {
  if (buf.length <= byteLimit) return buf;
  let end = byteLimit;
  // Back off while the byte at `end - 1` is a UTF-8 continuation byte (10xxxxxx).
  // Buffer indexing returns `number | undefined` under noUncheckedIndexedAccess;
  // readUInt8 returns `number` and is bounds-safe given our `end > 0` guard.
  while (end > 0 && (buf.readUInt8(end - 1) & 0xc0) === 0x80) end--;
  // Also back off the codepoint's leading byte (11xxxxxx) so we don't keep a partial codepoint.
  if (end > 0 && (buf.readUInt8(end - 1) & 0xc0) === 0xc0) end--;
  return buf.subarray(0, end);
}

export function readSourceCode(
  sourceFiles: string[],
  rootDir: string,
  opts?: ReadSourceCodeOpts,
): string {
  if (!sourceFiles || sourceFiles.length === 0) return "";

  const perFileBytes = Math.max(0, opts?.perFileBytes ?? DEFAULT_PER_FILE_BYTES);
  const totalBytes = Math.max(0, opts?.totalBytes ?? DEFAULT_TOTAL_BYTES);

  const entries: string[] = [];
  let used = 0;

  for (const rel of sourceFiles) {
    if (used >= totalBytes) break;
    // Silently skip malformed entries (null, undefined, non-string, empty).
    // Otherwise join(rootDir, rel) would throw TypeError outside the try blocks
    // below and kill the whole call.
    if (typeof rel !== "string" || rel.length === 0) continue;

    const abs = join(rootDir, rel);

    // Filter out anything that isn't a regular file. We never throw.
    let isFile = false;
    try {
      isFile = statSync(abs).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) continue;

    let raw: Buffer;
    try {
      raw = readFileSync(abs);
    } catch {
      continue;
    }

    const fileBudget = Math.min(perFileBytes, totalBytes - used);
    if (fileBudget <= 0) break;

    let body: string;
    let suffix = "";
    let keptBytes: number;
    if (raw.length > fileBudget) {
      // Trim to a codepoint boundary so toString("utf8") doesn't emit
      // U+FFFD at the cut point. `leftover` reflects the actual bytes
      // dropped after the codepoint-boundary trim.
      const trimmed = trimToCodepointBoundary(raw, fileBudget);
      const leftover = raw.length - trimmed.length;
      body = trimmed.toString("utf8");
      suffix = `\n// ...truncated (${leftover} more bytes)`;
      keptBytes = trimmed.length;
    } else {
      body = raw.toString("utf8");
      keptBytes = raw.length;
    }

    entries.push(`// FILE: ${rel}\n${body}${suffix}`);
    // Count only raw source bytes against the total budget; headers and
    // the truncation marker are bookkeeping, not "content".
    used += keptBytes;
  }

  return entries.join("\n\n");
}
