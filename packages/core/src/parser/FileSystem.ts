/**
 * Pluggable filesystem for parsers. `LocalFs` wraps `node:fs`; GitHubFs (D.5)
 * wraps Octokit + a SHA-keyed content cache. Same parser code works for both.
 *
 * Paths are all relative to `rootDir`. The implementation owns absolute-path
 * resolution; callers should never pre-join with `rootDir`.
 */
export interface ParserFileSystem {
  /**
   * Logical root for this filesystem. For LocalFs this is the absolute disk
   * path; for GitHubFs this is "/". Mostly used for diagnostic logs.
   */
  readonly rootDir: string;

  /** Read a UTF-8 text file. Throws ENOENT-shaped Error if missing. */
  readFile(relPath: string): Promise<string>;

  /** True if a file or directory exists at relPath. */
  exists(relPath: string): Promise<boolean>;

  /**
   * Filesystem entry metadata. `sha` is optional and present for GitHubFs
   * (blob SHA from the trees API). LocalFs leaves it undefined.
   */
  stat(relPath: string): Promise<{ size: number; isDirectory: boolean; sha?: string }>;

  /** Entries directly under relPath (non-recursive). */
  listDir(relPath: string): Promise<Array<{ name: string; isDirectory: boolean; sha?: string }>>;

  /**
   * Recursive walk. Yields every entry (files + directories). Implementation
   * is free to optimise (GitHubFs returns the full tree in one API call).
   *
   * `opts.ignore` is a list of full-path matches OR top-level segment matches
   * to skip — semantics: if any segment of a yielded path equals an ignore
   * entry, the entry is skipped (e.g. "node_modules" skips any descendant).
   */
  walk(
    relPath: string,
    opts?: { ignore?: string[] },
  ): AsyncIterable<{ path: string; isDirectory: boolean; sha?: string }>;

  /**
   * Return a new ParserFileSystem rooted at `${this.rootDir}/${relPath}`.
   * Used by subdirAwarePlugin to retry parser detection inside immediate
   * subdirs without filesystem-specific glue in the caller.
   *
   * Each implementation knows how to produce a sub-rooted view of itself:
   *   - LocalFs returns a new LocalFs at the joined disk path.
   *   - GitHubFs returns a view that prepends relPath to every read/stat/listDir
   *     call against the underlying tree (no extra API calls, since the tree
   *     is already resolved on the parent).
   */
  subFs(relPath: string): ParserFileSystem;
}
