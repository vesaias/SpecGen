/**
 * Pydantic class collector. v1 scope: direct subclasses of `BaseModel`.
 *
 * We don't track inheritance chains — if you have `class Foo(MyBase)` where
 * `MyBase(BaseModel)` is defined elsewhere, we won't pick up `Foo`. That's
 * accepted v1 cost; the wins from supporting it aren't worth the complexity
 * of two-pass class-resolution. (Hooks for transitive inheritance would
 * live here.)
 */

export interface PydanticField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface PydanticClass {
  name: string;
  fields: PydanticField[];
  sourceFile: string;
}

const CLASS_RE = /^class\s+(\w+)\s*\(\s*([^)]+)\)\s*:\s*$/;

/**
 * Extract Pydantic classes from a set of pre-loaded Python files.
 * Returned as a Map for cheap lookup by class name.
 */
export function extractPydanticClasses(
  files: Array<{ path: string; content: string }>,
): Map<string, PydanticClass> {
  const out = new Map<string, PydanticClass>();
  for (const { path, content } of files) {
    for (const cls of extractClassesFromFile(content, path)) {
      out.set(cls.name, cls);
    }
  }
  return out;
}

function extractClassesFromFile(content: string, path: string): PydanticClass[] {
  const lines = content.split("\n");
  const classes: PydanticClass[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(CLASS_RE);
    if (!m) continue;
    const className = m[1]!;
    const bases = m[2]!.split(",").map((b) => b.trim());
    // v1: only direct subclass of BaseModel (or `pydantic.BaseModel`, `pydantic.v1.BaseModel`)
    if (!bases.some((b) => b === "BaseModel" || b.endsWith(".BaseModel"))) continue;

    const fields = collectClassFields(lines, i + 1);
    classes.push({ name: className, fields, sourceFile: path });
  }
  return classes;
}

/**
 * Walk forward from the line *after* a `class Foo(...):` declaration,
 * collecting `field_name: type` lines until indentation returns to (or
 * below) the class-body level. Skips `class Config:` (Pydantic v1 sugar).
 */
export function collectClassFields(lines: string[], startIdx: number): PydanticField[] {
  // Determine the class-body indent from the first non-blank, non-comment line.
  let bodyIndent: number | null = null;
  const fields: PydanticField[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i]!;
    const stripped = raw.replace(/[\r\t]/g, " ");
    if (stripped.trim() === "") continue;
    if (stripped.trim().startsWith("#")) continue;

    const indent = countIndent(raw);
    if (bodyIndent === null) {
      bodyIndent = indent;
      if (bodyIndent === 0) break; // empty class body — next top-level statement
    }
    if (indent < bodyIndent) break;
    if (indent > bodyIndent) continue; // nested block (e.g. inside a method) — skip

    // A `class Config:` or any nested `class X:` ends a field but keeps us in the body
    if (/^class\s+\w+/.test(stripped.trim())) continue;
    // Skip `def` / `async def` blocks
    if (/^(async\s+)?def\s+\w+/.test(stripped.trim())) continue;

    const field = parseFieldLine(stripped.trim());
    if (field) fields.push(field);
  }
  return fields;
}

function countIndent(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i;
}

const FIELD_RE = /^(\w+)\s*:\s*([^=#]+?)(?:\s*=\s*(.+?))?\s*(?:#.*)?$/;

function parseFieldLine(line: string): PydanticField | null {
  const m = line.match(FIELD_RE);
  if (!m) return null;
  const name = m[1]!;
  // Skip dunders and `model_config` etc.
  if (name.startsWith("_")) return null;
  if (name === "model_config") return null;

  let type = m[2]!.trim();
  const defaultExpr = m[3]?.trim();

  // Treat Optional[X] / X | None / `= None` / explicit default → not required.
  const optionalWrapper = /^Optional\[(.+)\]$/.exec(type);
  if (optionalWrapper) type = optionalWrapper[1]!.trim();
  const unionNone = /^(.+)\s*\|\s*None\s*$/.exec(type);
  if (unionNone) type = unionNone[1]!.trim();

  const required = defaultExpr === undefined && !optionalWrapper && !unionNone;

  return { name, type, required, description: "" };
}
