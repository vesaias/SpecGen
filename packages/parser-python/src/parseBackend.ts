/**
 * Python backend parser orchestrator.
 *
 * Walks every `*.py` file under the rootDir (excluding standard noise dirs
 * and common test directories), collects Pydantic + SQLAlchemy class
 * definitions, then runs the FastAPI + Flask extractors with that context
 * for request-body enrichment.
 *
 * Test directories are excluded by name (`tests`, `test`) — most real Python
 * projects keep them out of the production route surface. If a project keeps
 * routes in `test_` modules they'll be missed; that's a documented v1 cost.
 */
import type { BackendSpec, ParseInput, ParseResult, ParserFileSystem } from "@specgen/core";
import { extractFastApiRoutes } from "./fastapi.js";
import { extractFlaskRoutes } from "./flask.js";
import { extractPydanticClasses } from "./pydantic.js";
import { extractSqlAlchemyModels } from "./sqlalchemy.js";

const MAX_FILES = 10_000;

const IGNORE_DIRS = [
  "__pycache__",
  "venv",
  ".venv",
  "node_modules",
  ".git",
  "dist",
  "build",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "tests",
  "test",
];

export interface PythonParseFile {
  path: string;
  content: string;
}

async function loadPyFiles(fsys: ParserFileSystem): Promise<PythonParseFile[]> {
  const out: PythonParseFile[] = [];
  for await (const entry of fsys.walk("", { ignore: IGNORE_DIRS })) {
    if (entry.isDirectory) continue;
    if (!entry.path.endsWith(".py")) continue;
    out.push({ path: entry.path, content: await fsys.readFile(entry.path) });
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

export async function parseBackend(input: ParseInput): Promise<ParseResult> {
  const files = await loadPyFiles(input.fs);
  const warnings: string[] = [];

  if (files.length >= MAX_FILES) {
    warnings.push(
      `parser-python: hit file cap (${MAX_FILES}) — some routes may be missing. Narrow the scan by trimming \`ignore\` dirs or splitting the codebase.`,
    );
  }

  const pydanticClasses = extractPydanticClasses(files);
  const sqlAlchemyModels = extractSqlAlchemyModels(files);

  const ctx = { pydanticClasses, sqlAlchemyModels };
  const fastApiRoutes = extractFastApiRoutes(files, ctx);
  const flaskRoutes = extractFlaskRoutes(files, ctx);

  const endpoints: BackendSpec[] = [...fastApiRoutes, ...flaskRoutes];

  return {
    endpoints,
    pages: [],
    events: [],
    warnings,
  };
}
