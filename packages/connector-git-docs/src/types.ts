/**
 * Config + error types for the Git /docs push connector (Task D.6).
 *
 * The DocsPushService accepts a fully-resolved DocsPushConfig from the caller
 * (typically the REST handler) and reports progress via optional callbacks.
 * The PAT is supplied here but is NEVER written to .git/config — it's injected
 * via `http.extraheader` at clone/fetch/push time only.
 */
export interface DocsPushConfig {
  /** Where to clone the target repo on disk. Caller manages lifecycle. */
  cacheDir: string;
  /** Full HTTPS clone URL. Don't bake the token in — we inject via http.extraheader. */
  cloneUrl: string;
  /** Branch we push to. Default 'specgen-docs'. Refuse 'main'/'master' under force strategy. */
  targetBranch: string;
  /** Directory under the repo root to write Markdown into. Default 'docs'. */
  docsRoot: string;
  /** PAT — never persisted to .git/config; passed only via http.extraheader. */
  token: string;
  author: { name: string; email: string };
  /** force = reset hard to remote; halt = throw DocsPushConflictError if remote drifted. */
  overwriteStrategy: "force" | "halt";
  /** Optional metadata for commit message / repository state row. */
  runId: string;
  sourceCommitSha?: string;
  /** Last SHA we pushed (from repository.exports.gitDocs.lastPushedSha) — used for conflict detection. */
  lastPushedSha?: string;
  /** Optional warning emitter — wires to RunEventBroker. */
  onWarning?: (msg: string) => void;
  /** Optional progress logger. */
  onProgress?: (msg: string) => void;
}

export interface DocsPushResult {
  /** SHA of the commit we just pushed, or null if nothing changed. */
  pushedSha: string | null;
  /** Number of files written under docsRoot. */
  filesWritten: number;
}

export class DocsPushConflictError extends Error {
  constructor(
    message: string,
    readonly remoteSha: string,
    readonly expectedSha: string,
  ) {
    super(message);
    this.name = "DocsPushConflictError";
  }
}
