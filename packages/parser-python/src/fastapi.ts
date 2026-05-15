/**
 * FastAPI route extractor.
 *
 * Strategy: line-by-line scan + minimal state tracking. NOT a Python AST.
 *
 * Per-file passes:
 *   1. Collect `app = FastAPI(...)` and `router = APIRouter(prefix=..., tags=...)`
 *      assignments → variable name → prefix.
 *   2. Collect `app.include_router(router, prefix="/api/v1")` calls
 *      → router variable name → include-prefix applied later.
 *   3. Scan for `@<var>.<method>("/path", ...)` decorators followed by
 *      `def`/`async def`. Combine include-prefix + router-prefix + decorator-path
 *      to get the full route. Parse signature for path/body/query params.
 *
 * Cross-file: `include_router` registration is global per the v1 plan — if
 * file A defines `router` and file B does `app.include_router(router, ...)`,
 * we won't link them. Real FastAPI apps almost always include routers in the
 * same file the app lives in (or at the top-level), so this covers the
 * dominant case. Out-of-scope edge.
 */
import type { BackendSpec } from "@specgen/core";
import type { PydanticClass } from "./pydantic.js";
import type { SqlAlchemyModel } from "./sqlalchemy.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

export interface FastApiContext {
  pydanticClasses: Map<string, PydanticClass>;
  sqlAlchemyModels: Map<string, SqlAlchemyModel>;
}

interface RouterInfo {
  prefix: string;
  /** Prefix added later by `include_router(router, prefix=...)` */
  includePrefix: string;
}

const APP_FASTAPI_RE = /^\s*(\w+)\s*=\s*FastAPI\s*\(/;
const APP_FASTAPI_DOTTED_RE = /^\s*(\w+)\s*=\s*fastapi\.FastAPI\s*\(/;
const ROUTER_RE = /^\s*(\w+)\s*=\s*(?:APIRouter|fastapi\.APIRouter)\s*\(([^)]*)\)/;
const INCLUDE_RE = /(\w+)\.include_router\s*\(\s*(\w+)([^)]*)\)/g;
const DEF_RE = /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+?))?\s*:/;

/**
 * Extract FastAPI endpoints from a flat list of pre-loaded files.
 * Each file is treated independently for router-var state; cross-file
 * `include_router` linkage is not attempted (see module doc).
 */
export function extractFastApiRoutes(
  files: Array<{ path: string; content: string }>,
  ctx: FastApiContext,
): BackendSpec[] {
  const out: BackendSpec[] = [];
  for (const f of files) {
    out.push(...extractFromFile(f.path, f.content, ctx));
  }
  return out;
}

function extractFromFile(filePath: string, content: string, ctx: FastApiContext): BackendSpec[] {
  // Quick filter: skip files that clearly aren't FastAPI users
  if (!/(FastAPI|APIRouter|@\w+\.(get|post|put|patch|delete)\s*\()/.test(content)) {
    return [];
  }

  const lines = content.split("\n");

  // Pass 1 — collect app + router assignments
  const routers = new Map<string, RouterInfo>();
  const appVars = new Set<string>();

  for (const line of lines) {
    let m = line.match(APP_FASTAPI_RE) ?? line.match(APP_FASTAPI_DOTTED_RE);
    if (m) {
      appVars.add(m[1]!);
      routers.set(m[1]!, { prefix: "", includePrefix: "" });
      continue;
    }
    m = line.match(ROUTER_RE);
    if (m) {
      const varName = m[1]!;
      const args = m[2]!;
      const prefix = extractKwarg(args, "prefix") ?? "";
      routers.set(varName, { prefix, includePrefix: "" });
    }
  }

  // Pass 2 — apply `<app>.include_router(<router>, prefix="...")`
  for (const line of lines) {
    INCLUDE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INCLUDE_RE.exec(line)) !== null) {
      const parentVar = m[1]!;
      const routerVar = m[2]!;
      const tail = m[3] ?? "";
      if (!appVars.has(parentVar) && !routers.has(parentVar)) continue;
      const includePrefix = extractKwarg(tail, "prefix") ?? "";
      // Stack the parent's include prefix (covers nested include_router chains)
      const parentInfo = routers.get(parentVar);
      const parentChain = parentInfo ? joinPrefix(parentInfo.includePrefix, parentInfo.prefix) : "";
      const existing = routers.get(routerVar) ?? { prefix: "", includePrefix: "" };
      existing.includePrefix = joinPrefix(parentChain, includePrefix);
      routers.set(routerVar, existing);
    }
  }

  // Pass 3 — scan for decorator + def pairs
  const specs: BackendSpec[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const dec = matchDecoratorBlock(lines, i);
    if (!dec) continue;
    const { varName, method, args, endIdx } = dec;

    const routerInfo = routers.get(varName);
    if (!routerInfo) continue;

    // Find the next `def` / `async def` (skipping subsequent stacked decorators)
    let j = endIdx + 1;
    while (j < lines.length) {
      const candidate = lines[j]!;
      if (candidate.trim() === "" || candidate.trim().startsWith("#")) {
        j++;
        continue;
      }
      if (candidate.trim().startsWith("@")) {
        // Stacked decorator: keep walking
        // But if it's another @x.<method>(...), this decorator pair belongs to a different handler.
        // We'll just continue — the line will be picked up by the outer loop.
        j++;
        continue;
      }
      break;
    }
    if (j >= lines.length) continue;

    // The def may span multiple lines (long signature). Collect until the closing `):`.
    const defLine = collectDefSignature(lines, j);
    if (!defLine) continue;
    const defMatch = defLine.text.match(DEF_RE);
    if (!defMatch) continue;

    const fnName = defMatch[1]!;
    const params = defMatch[2]!;
    const returnAnnotation = defMatch[3]?.trim();

    // Path is the first positional arg of the decorator
    const decoratorPath = extractFirstPositional(args) ?? "";
    const fullPath = normalizePath(
      joinPrefix(joinPrefix(routerInfo.includePrefix, routerInfo.prefix), decoratorPath),
    );

    // response_model kwarg → preferred response type
    const responseModel = extractKwarg(args, "response_model") ?? returnAnnotation;

    const parameters: BackendSpec["parameters"] = [];
    const pathParamNames = (fullPath.match(/\{([^}]+)\}/g) ?? []).map((p) => p.slice(1, -1));
    let requestBody: BackendSpec["requestBody"] | undefined;

    const sigParams = splitParams(params);
    for (const p of sigParams) {
      const parsed = parseSignatureParam(p);
      if (!parsed) continue;
      // Skip `self` / `cls` if it slipped in
      if (parsed.name === "self" || parsed.name === "cls") continue;
      // Skip `Depends(...)` and `Request` / `Response` plumbing — out of scope for v1
      if (parsed.isDepends) continue;

      if (pathParamNames.includes(parsed.name)) {
        parameters.push({
          name: parsed.name,
          location: "path",
          type: parsed.type,
          required: true,
          description: "",
        });
        continue;
      }

      // Body candidate: type matches a known Pydantic class
      if (ctx.pydanticClasses.has(stripOptional(parsed.type))) {
        const dtoName = stripOptional(parsed.type);
        const cls = ctx.pydanticClasses.get(dtoName)!;
        requestBody = {
          dtoName,
          fields: cls.fields.map((f) => ({
            name: f.name,
            type: f.type,
            required: f.required,
            description: f.description,
          })),
        };
        parameters.push({
          name: parsed.name,
          location: "body",
          type: dtoName,
          required: !parsed.hasDefault,
          description: "",
        });
        continue;
      }

      // Otherwise treat as a query param
      parameters.push({
        name: parsed.name,
        location: "query",
        type: parsed.type,
        required: !parsed.hasDefault,
        description: "",
      });
    }

    // Responses: leave empty for AI enrichment, but stamp the response_model
    // type onto a 200 entry when we have one — gives downstream prompts the
    // shape without forcing us to invent statuses.
    const responses: BackendSpec["responses"] = [];
    if (responseModel) {
      responses.push({
        status: 200,
        type: stripOptional(responseModel),
        description: "Success",
      });
    }

    specs.push({
      endpoint: `${method.toUpperCase()} ${fullPath}`,
      method: method.toUpperCase(),
      route: fullPath,
      controller: controllerNameFromPath(filePath),
      summary: "[TODO: Human fills]",
      context: "[TODO: Human fills]",
      parameters,
      requestBody,
      responses,
      validationRules: [],
      orchestration: [],
      dependencies: [],
      sourceFiles: [filePath],
    });
    // Suppress unused-var warning for `fnName` — the function name doesn't
    // surface in the spec today, but keeping the extracted value documents
    // intent for downstream enrichment.
    void fnName;
    void line;
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Match a decorator that might span multiple lines (e.g. complex kwargs).
 * Returns the var, method, joined args, and the last line index consumed.
 */
function matchDecoratorBlock(
  lines: string[],
  i: number,
): { varName: string; method: HttpMethod; args: string; endIdx: number } | null {
  const startLine = lines[i]!;
  if (!/^\s*@\w+\.(get|post|put|patch|delete)\s*\(/.test(startLine)) return null;
  // Collect until the parenthesis balances
  let buf = startLine;
  let depth = countOpen(startLine) - countClose(startLine);
  let j = i;
  while (depth > 0 && j + 1 < lines.length) {
    j++;
    buf += `\n${lines[j]}`;
    depth += countOpen(lines[j]!) - countClose(lines[j]!);
  }
  // Strip everything up through the @x.method( and the final )
  const m = buf.match(/^\s*@(\w+)\.(get|post|put|patch|delete)\s*\(([\s\S]*)\)\s*$/);
  if (!m) return null;
  return {
    varName: m[1]!,
    method: m[2] as HttpMethod,
    args: m[3]!,
    endIdx: j,
  };
}

function collectDefSignature(lines: string[], i: number): { text: string; endIdx: number } | null {
  if (!/^\s*(async\s+)?def\s+/.test(lines[i]!)) return null;
  let buf = lines[i]!;
  let depth = countOpen(buf) - countClose(buf);
  let j = i;
  while (depth > 0 && j + 1 < lines.length) {
    j++;
    buf += `\n${lines[j]}`;
    depth += countOpen(lines[j]!) - countClose(lines[j]!);
  }
  // Collapse to one line for the regex
  return { text: buf.replace(/\n/g, " "), endIdx: j };
}

function countOpen(s: string): number {
  let n = 0;
  for (const c of s) if (c === "(") n++;
  return n;
}
function countClose(s: string): number {
  let n = 0;
  for (const c of s) if (c === ")") n++;
  return n;
}

/** Pull `kwarg="value"` (or single-quoted) from a function call arg string. */
function extractKwarg(args: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([\\w.]+))`);
  const m = args.match(re);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

/** Pull the first positional arg from a function call arg string. */
function extractFirstPositional(args: string): string | undefined {
  const trimmed = args.replace(/^\s+/, "");
  const m = trimmed.match(/^(?:"([^"]*)"|'([^']*)')/);
  if (!m) return undefined;
  return m[1] ?? m[2];
}

function joinPrefix(a: string, b: string): string {
  if (!a && !b) return "";
  if (!a) return b;
  if (!b) return a;
  const left = a.endsWith("/") ? a.slice(0, -1) : a;
  const right = b.startsWith("/") ? b : `/${b}`;
  return left + right;
}

function normalizePath(p: string): string {
  if (!p) return "/";
  let out = p.startsWith("/") ? p : `/${p}`;
  out = out.replace(/\/+/g, "/");
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

interface ParsedSignatureParam {
  name: string;
  type: string;
  hasDefault: boolean;
  isDepends: boolean;
}

function splitParams(params: string): string[] {
  // Split on commas *not inside brackets/parens*
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const c of params) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

const PARAM_RE = /^\s*(\w+)\s*(?::\s*([^=]+?))?(?:\s*=\s*(.+))?\s*$/;

function parseSignatureParam(raw: string): ParsedSignatureParam | null {
  const m = raw.match(PARAM_RE);
  if (!m) return null;
  const name = m[1]!;
  if (name === "" || name === "*" || name === "**") return null;
  const type = (m[2] ?? "Any").trim();
  const defaultExpr = m[3]?.trim();

  // Detect Depends() — strip from consideration (out of v1 scope)
  const isDepends = !!defaultExpr && /^Depends\s*\(/.test(defaultExpr);

  return {
    name,
    type,
    hasDefault: defaultExpr !== undefined,
    isDepends,
  };
}

function stripOptional(t: string): string {
  const m = t.match(/^Optional\[(.+)\]$/);
  if (m) return m[1]!.trim();
  const u = t.match(/^(.+)\s*\|\s*None\s*$/);
  if (u) return u[1]!.trim();
  return t;
}

function controllerNameFromPath(p: string): string {
  // e.g. `app/api/users.py` → `Users`
  const base = p.split(/[\\/]/).pop() ?? p;
  const stem = base.replace(/\.py$/, "");
  if (!stem) return p;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}
