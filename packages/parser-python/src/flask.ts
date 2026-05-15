/**
 * Flask route extractor.
 *
 * Patterns covered (v1):
 *   - `@app.route("/path", methods=["GET", "POST"])` on `app = Flask(__name__)`
 *   - `@bp.route("/path", methods=[...])` on `bp = Blueprint("name", __name__, url_prefix="/api")`
 *   - Method-specific shortcuts: `@app.get("/path")`, `@app.post(...)`, etc.
 *
 * One BackendSpec is emitted per (method, path) — i.e. a `methods=["GET", "POST"]`
 * decorator produces two BackendSpec items.
 */
import type { BackendSpec } from "@specgen/core";
import type { PydanticClass } from "./pydantic.js";
import type { SqlAlchemyModel } from "./sqlalchemy.js";

export interface FlaskContext {
  pydanticClasses: Map<string, PydanticClass>;
  sqlAlchemyModels: Map<string, SqlAlchemyModel>;
}

const FLASK_APP_RE = /^\s*(\w+)\s*=\s*Flask\s*\(/;
const BLUEPRINT_RE = /^\s*(\w+)\s*=\s*Blueprint\s*\(([^)]*)\)/;
const DEF_RE = /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+?))?\s*:/;

export function extractFlaskRoutes(
  files: Array<{ path: string; content: string }>,
  ctx: FlaskContext,
): BackendSpec[] {
  const out: BackendSpec[] = [];
  for (const f of files) {
    out.push(...extractFromFile(f.path, f.content, ctx));
  }
  return out;
}

function extractFromFile(filePath: string, content: string, _ctx: FlaskContext): BackendSpec[] {
  if (!/Flask|Blueprint|@\w+\.(route|get|post|put|patch|delete)\s*\(/.test(content)) return [];

  const lines = content.split("\n");

  // Pass 1 — Flask app + Blueprint assignments
  const flaskVars = new Map<string, { prefix: string }>();
  for (const line of lines) {
    const appMatch = line.match(FLASK_APP_RE);
    if (appMatch) {
      flaskVars.set(appMatch[1]!, { prefix: "" });
      continue;
    }
    const bpMatch = line.match(BLUEPRINT_RE);
    if (bpMatch) {
      const varName = bpMatch[1]!;
      const args = bpMatch[2]!;
      const prefix = extractKwarg(args, "url_prefix") ?? "";
      flaskVars.set(varName, { prefix });
    }
  }

  const specs: BackendSpec[] = [];
  for (let i = 0; i < lines.length; i++) {
    const dec = matchDecoratorBlock(lines, i);
    if (!dec) continue;
    const { varName, fnName: shortMethod, args, endIdx } = dec;

    const info = flaskVars.get(varName);
    if (!info) continue;

    // Find the next def
    let j = endIdx + 1;
    while (
      j < lines.length &&
      (lines[j]!.trim() === "" ||
        lines[j]!.trim().startsWith("#") ||
        lines[j]!.trim().startsWith("@"))
    ) {
      j++;
    }
    if (j >= lines.length) continue;

    const defSig = collectDefSignature(lines, j);
    if (!defSig) continue;
    const defMatch = defSig.text.match(DEF_RE);
    if (!defMatch) continue;
    const fnName = defMatch[1]!;
    const params = defMatch[2]!;

    const decoratorPath = extractFirstPositional(args) ?? "";
    const fullPath = normalizePath(joinPrefix(info.prefix, decoratorPath));

    // Determine methods
    let methods: string[];
    if (shortMethod === "route") {
      const methodsKwarg = extractListKwarg(args, "methods");
      methods = methodsKwarg.length > 0 ? methodsKwarg : ["GET"];
    } else {
      methods = [shortMethod.toUpperCase()];
    }

    const parameters = buildFlaskParameters(fullPath, params);

    for (const m of methods) {
      const method = m.toUpperCase();
      specs.push({
        endpoint: `${method} ${fullPath}`,
        method,
        route: fullPath,
        controller: controllerNameFromPath(filePath),
        summary: "[TODO: Human fills]",
        context: "[TODO: Human fills]",
        parameters,
        responses: [],
        validationRules: [],
        orchestration: [],
        dependencies: [],
        sourceFiles: [filePath],
      });
    }
    void fnName;
  }

  return specs;
}

function buildFlaskParameters(path: string, params: string): BackendSpec["parameters"] {
  const out: BackendSpec["parameters"] = [];
  // Flask path syntax: `<int:user_id>` or `<user_id>`
  const flaskPathParamRe = /<(?:(\w+):)?(\w+)>/g;
  const pathParamNames = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = flaskPathParamRe.exec(path)) !== null) {
    const converter = m[1] ?? "string";
    const name = m[2]!;
    pathParamNames.add(name);
    out.push({
      name,
      location: "path",
      type: converter,
      required: true,
      description: "",
    });
  }

  // Anything else in the signature → query (Flask doesn't use type-annotated
  // bodies the way FastAPI does; v1 leaves request-body discovery out for Flask)
  const sigParams = splitParams(params);
  for (const p of sigParams) {
    const parsed = parseSignatureParam(p);
    if (!parsed) continue;
    if (parsed.name === "self" || parsed.name === "cls") continue;
    if (pathParamNames.has(parsed.name)) continue;
    out.push({
      name: parsed.name,
      location: "query",
      type: parsed.type,
      required: !parsed.hasDefault,
      description: "",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers (shared shape with fastapi.ts; kept local to avoid premature DRY)
// ---------------------------------------------------------------------------

function matchDecoratorBlock(
  lines: string[],
  i: number,
): { varName: string; fnName: string; args: string; endIdx: number } | null {
  const startLine = lines[i]!;
  if (!/^\s*@\w+\.(route|get|post|put|patch|delete)\s*\(/.test(startLine)) return null;
  let buf = startLine;
  let depth = countOpen(startLine) - countClose(startLine);
  let j = i;
  while (depth > 0 && j + 1 < lines.length) {
    j++;
    buf += `\n${lines[j]}`;
    depth += countOpen(lines[j]!) - countClose(lines[j]!);
  }
  const m = buf.match(/^\s*@(\w+)\.(route|get|post|put|patch|delete)\s*\(([\s\S]*)\)\s*$/);
  if (!m) return null;
  return { varName: m[1]!, fnName: m[2]!, args: m[3]!, endIdx: j };
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

function extractKwarg(args: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([\\w.]+))`);
  const m = args.match(re);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

function extractListKwarg(args: string, name: string): string[] {
  const re = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`);
  const m = args.match(re);
  if (!m) return [];
  return m[1]!
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

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
}

function splitParams(params: string): string[] {
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
  if (!name || name === "*" || name === "**") return null;
  return {
    name,
    type: (m[2] ?? "Any").trim(),
    hasDefault: m[3] !== undefined,
  };
}

function controllerNameFromPath(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  const stem = base.replace(/\.py$/, "");
  if (!stem) return p;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}
