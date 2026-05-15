import { safeParseJson } from "@specgen/core";
import type { AiClient, ParserFileSystem } from "@specgen/core";

/**
 * One project root the classifier identified in the repo. A monorepo may yield
 * several; a single-language repo yields one.
 */
export interface ClassifiedProject {
  /** "backend-python" | "frontend-react" | "backend-dotnet" | "backend-go" | ... */
  kind: string;
  /** "/", "/backend", "/services/api" — repo-relative. */
  rootDir: string;
  /** "fastapi", "flask", "react", "vue", "express", "asp.net", ... */
  framework: string;
  /** 0..1. */
  confidence: number;
  /** Subset of {"dotnet","python","react"} — empty if no rule parser fits. */
  suggestedParsers: string[];
  /** Short human reason surfaced in the UI. */
  notes: string;
}

export interface ProjectClassification {
  projects: ClassifiedProject[];
  /** Free-text summary of the codebase shape. */
  summary: string;
}

export interface ClassifyProjectOpts {
  /**
   * Optional. When the source is GitHub + a token is available, the helper
   * hits /repos/{owner}/{repo}/languages and folds the result into the AI
   * context. Skipped silently on 401/403/404 (no point bubbling).
   */
  github?: { owner: string; repo: string; token: string };
  /** AI client to use. Caller resolves provider. */
  ai: AiClient;
  /** Model id. */
  model: string;
  /** Override `fetch` for tests. */
  fetch?: typeof globalThis.fetch;
}

// Marker files we sniff at root + immediate subdirs. Each is capped at 4 KB.
const MARKER_FILE_NAMES = [
  "README.md",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Cargo.toml",
  "go.mod",
];
const MARKER_FILE_GLOBS = [/\.csproj$/i, /\.sln$/i];

const PER_FILE_CAP_BYTES = 4 * 1024; // 4 KB
const TOTAL_FILES_CAP_BYTES = 20 * 1024; // 20 KB total across all marker reads
const MAX_MARKER_FILES = 6;
const MAX_ENTRIES_PER_DIR = 50;

const SYSTEM_PROMPT = `You classify codebases. Given a directory listing, key marker files, and (optionally) a language-bytes breakdown from GitHub, identify every distinct project root in the repository and return strict JSON matching the schema below. A monorepo may have multiple projects (e.g. /backend = python, /frontend = react). One project may use multiple languages (e.g. .NET API with React SPA in same dir). suggestedParsers must come from this list: dotnet, python, react. If no rule parser matches, leave suggestedParsers empty. Use the GitHub bytes breakdown to inform confidence and to surface languages whose marker files might be in unusual locations.

Return JSON of this exact shape:
{
  "projects": [
    {
      "kind": "string",
      "rootDir": "string",
      "framework": "string",
      "confidence": 0.0,
      "suggestedParsers": ["string"],
      "notes": "string"
    }
  ],
  "summary": "string"
}`;

/**
 * Classify a project at probe time. Returns null on AI failure / parse failure;
 * caller must treat that as "no AI classification available" rather than fatal.
 */
export async function classifyProject(
  fs: ParserFileSystem,
  opts: ClassifyProjectOpts,
): Promise<ProjectClassification | null> {
  // 1. Walk top 2 levels of dirs.
  const listing = await buildDirectoryListing(fs);

  // 2. Read marker files (root + immediate subdirs).
  const markerFiles = await readMarkerFiles(fs);

  // 3. Optionally fetch GitHub languages breakdown.
  let languagesBytes: Record<string, number> | null = null;
  if (opts.github) {
    languagesBytes = await fetchGitHubLanguages(opts.github, opts.fetch);
  }

  // 4. Render prompt.
  const userPrompt = renderPrompt({ listing, markerFiles, languagesBytes });

  // 5. Call AI (single call, low max_tokens, low temperature).
  let text: string;
  try {
    const result = await opts.ai.complete({
      prompt: userPrompt,
      system: SYSTEM_PROMPT,
      model: opts.model,
      temperature: 0.1,
      maxTokens: 1500,
    });
    text = result.text;
  } catch {
    return null;
  }

  // 6. Parse + validate the response shape.
  const parsed = safeParseJson(text);
  return coerceClassification(parsed);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface DirectoryListing {
  /** Top-level entries (cap MAX_ENTRIES_PER_DIR). */
  root: string[];
  /** Immediate-subdir → its entries (cap MAX_ENTRIES_PER_DIR per dir). */
  subdirs: Array<{ dir: string; entries: string[] }>;
}

async function buildDirectoryListing(fs: ParserFileSystem): Promise<DirectoryListing> {
  let rootEntries: Array<{ name: string; isDirectory: boolean }> = [];
  try {
    rootEntries = await fs.listDir("");
  } catch {
    return { root: [], subdirs: [] };
  }
  const root = rootEntries
    .slice(0, MAX_ENTRIES_PER_DIR)
    .map((e) => (e.isDirectory ? `${e.name}/` : e.name));

  const subdirs: Array<{ dir: string; entries: string[] }> = [];
  for (const entry of rootEntries) {
    if (!entry.isDirectory) continue;
    if (shouldSkipDir(entry.name)) continue;
    try {
      const inner = await fs.listDir(entry.name);
      subdirs.push({
        dir: entry.name,
        entries: inner
          .slice(0, MAX_ENTRIES_PER_DIR)
          .map((e) => (e.isDirectory ? `${e.name}/` : e.name)),
      });
    } catch {
      // skip silently
    }
  }
  return { root, subdirs };
}

function shouldSkipDir(name: string): boolean {
  // Walking node_modules / .git / build dirs is a giant waste of API quota
  // and offers zero signal.
  return [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".vite",
    "venv",
    ".venv",
    "__pycache__",
    "target",
    "bin",
    "obj",
  ].includes(name);
}

interface MarkerFile {
  path: string;
  content: string;
  truncated: boolean;
}

async function readMarkerFiles(fs: ParserFileSystem): Promise<MarkerFile[]> {
  // Candidate paths: marker files at root, and at every immediate subdir.
  const candidates: string[] = [];

  // Root entries first.
  let rootEntries: Array<{ name: string; isDirectory: boolean }> = [];
  try {
    rootEntries = await fs.listDir("");
  } catch {
    return [];
  }
  for (const e of rootEntries) {
    if (e.isDirectory) continue;
    if (MARKER_FILE_NAMES.includes(e.name) || MARKER_FILE_GLOBS.some((g) => g.test(e.name))) {
      candidates.push(e.name);
    }
  }

  // Immediate subdir entries.
  for (const e of rootEntries) {
    if (!e.isDirectory || shouldSkipDir(e.name)) continue;
    try {
      const inner = await fs.listDir(e.name);
      for (const f of inner) {
        if (f.isDirectory) continue;
        if (MARKER_FILE_NAMES.includes(f.name) || MARKER_FILE_GLOBS.some((g) => g.test(f.name))) {
          candidates.push(`${e.name}/${f.name}`);
        }
      }
    } catch {
      // ignore
    }
  }

  // Read up to MAX_MARKER_FILES; total cap TOTAL_FILES_CAP_BYTES.
  const out: MarkerFile[] = [];
  let totalBytes = 0;
  for (const relPath of candidates) {
    if (out.length >= MAX_MARKER_FILES) break;
    if (totalBytes >= TOTAL_FILES_CAP_BYTES) break;
    try {
      const raw = await fs.readFile(relPath);
      const byteLen = Buffer.byteLength(raw, "utf8");
      let kept = raw;
      let truncated = false;
      if (byteLen > PER_FILE_CAP_BYTES) {
        kept = raw.slice(0, PER_FILE_CAP_BYTES);
        truncated = true;
      }
      const keptLen = Buffer.byteLength(kept, "utf8");
      // If adding this file would push us over the total budget, slice further.
      const remaining = TOTAL_FILES_CAP_BYTES - totalBytes;
      if (keptLen > remaining) {
        kept = kept.slice(0, remaining);
        truncated = true;
      }
      totalBytes += Buffer.byteLength(kept, "utf8");
      out.push({ path: relPath, content: kept, truncated });
    } catch {
      // ignore unreadable
    }
  }
  return out;
}

async function fetchGitHubLanguages(
  github: { owner: string; repo: string; token: string },
  fetchImpl?: typeof globalThis.fetch,
): Promise<Record<string, number> | null> {
  const f = fetchImpl ?? globalThis.fetch;
  try {
    const res = await f(
      `https://api.github.com/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/languages`,
      {
        headers: {
          Authorization: `Bearer ${github.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    // 401 / 403 / 404 — skip silently per spec.
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, number>;
    if (!data || typeof data !== "object") return null;
    // Filter to plain number values.
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "number") out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

function renderPrompt(args: {
  listing: DirectoryListing;
  markerFiles: MarkerFile[];
  languagesBytes: Record<string, number> | null;
}): string {
  const parts: string[] = [];

  parts.push("# Repository directory listing");
  parts.push("## Root");
  if (args.listing.root.length === 0) {
    parts.push("(empty)");
  } else {
    parts.push(args.listing.root.join("\n"));
  }
  for (const sub of args.listing.subdirs) {
    parts.push(`## ${sub.dir}/`);
    if (sub.entries.length === 0) parts.push("(empty)");
    else parts.push(sub.entries.join("\n"));
  }

  if (args.markerFiles.length > 0) {
    parts.push("\n# Marker files");
    for (const mf of args.markerFiles) {
      parts.push(`## ${mf.path}${mf.truncated ? " (truncated)" : ""}`);
      parts.push("```");
      parts.push(mf.content);
      parts.push("```");
    }
  }

  if (args.languagesBytes) {
    parts.push("\n# GitHub languages breakdown (bytes per language)");
    const entries = Object.entries(args.languagesBytes).sort(([, a], [, b]) => b - a);
    for (const [lang, bytes] of entries) {
      parts.push(`- ${lang}: ${bytes}`);
    }
  }

  parts.push("\nReturn only the JSON object. Do not wrap it in prose.");
  return parts.join("\n");
}

/**
 * Best-effort shape-coercion. Returns null when the parsed value is not a
 * recognisable ProjectClassification (e.g. AI returned plain prose).
 */
function coerceClassification(parsed: unknown): ProjectClassification | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.projects)) return null;

  const projects: ClassifiedProject[] = [];
  for (const raw of obj.projects) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const kind = typeof r.kind === "string" ? r.kind : "";
    const rootDir = typeof r.rootDir === "string" ? r.rootDir : "/";
    const framework = typeof r.framework === "string" ? r.framework : "";
    const confidence =
      typeof r.confidence === "number" && Number.isFinite(r.confidence)
        ? Math.max(0, Math.min(1, r.confidence))
        : 0;
    const suggestedParsers = Array.isArray(r.suggestedParsers)
      ? r.suggestedParsers.filter((p): p is string => typeof p === "string")
      : [];
    const notes = typeof r.notes === "string" ? r.notes : "";
    if (!kind && !framework && suggestedParsers.length === 0) continue;
    projects.push({ kind, rootDir, framework, confidence, suggestedParsers, notes });
  }

  const summary = typeof obj.summary === "string" ? obj.summary : "";
  return { projects, summary };
}
