/**
 * SQLAlchemy model collector. v1 scope: regex-detect classes whose base name
 * ends in `Base` (covers `Base`, `DeclarativeBase`, custom declarative bases
 * like `AppBase`, etc.) and extract `field = Column(<type>, ...)` lines.
 *
 * These aren't emitted as endpoints; they're available for downstream lookups
 * (e.g. if a route returns a SQLAlchemy model directly, we know its shape).
 */

export interface SqlAlchemyField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface SqlAlchemyModel {
  name: string;
  fields: SqlAlchemyField[];
  sourceFile: string;
}

const CLASS_RE = /^class\s+(\w+)\s*\(\s*([^)]+)\)\s*:\s*$/;

export function extractSqlAlchemyModels(
  files: Array<{ path: string; content: string }>,
): Map<string, SqlAlchemyModel> {
  const out = new Map<string, SqlAlchemyModel>();
  for (const { path, content } of files) {
    for (const cls of extractModelsFromFile(content, path)) {
      out.set(cls.name, cls);
    }
  }
  return out;
}

function extractModelsFromFile(content: string, path: string): SqlAlchemyModel[] {
  const lines = content.split("\n");
  const models: SqlAlchemyModel[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(CLASS_RE);
    if (!m) continue;
    const className = m[1]!;
    const bases = m[2]!.split(",").map((b) => b.trim());
    // Any base ending in `Base` — captures `Base`, `DeclarativeBase`, `AppBase`, etc.
    if (!bases.some((b) => /(^|\.)\w*Base$/.test(b))) continue;

    const fields = collectModelFields(lines, i + 1);
    models.push({ name: className, fields, sourceFile: path });
  }
  return models;
}

function collectModelFields(lines: string[], startIdx: number): SqlAlchemyField[] {
  let bodyIndent: number | null = null;
  const fields: SqlAlchemyField[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i]!;
    const stripped = raw.replace(/[\r\t]/g, " ");
    if (stripped.trim() === "") continue;
    if (stripped.trim().startsWith("#")) continue;

    const indent = countIndent(raw);
    if (bodyIndent === null) {
      bodyIndent = indent;
      if (bodyIndent === 0) break;
    }
    if (indent < bodyIndent) break;
    if (indent > bodyIndent) continue;

    if (/^class\s+\w+/.test(stripped.trim())) continue;
    if (/^(async\s+)?def\s+\w+/.test(stripped.trim())) continue;

    const f = parseColumnLine(stripped.trim());
    if (f) fields.push(f);
  }
  return fields;
}

function countIndent(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i;
}

// `name = Column(String, nullable=False)` (legacy)
// `name: Mapped[str] = mapped_column(String, ...)` (SQLAlchemy 2.x typed)
const LEGACY_COLUMN_RE = /^(\w+)\s*=\s*Column\(\s*([\w.]+)(?:\s*\(.*\))?\s*(?:,([^)]*))?\)/;
const MAPPED_COLUMN_RE = /^(\w+)\s*:\s*Mapped\[([^\]]+)\]\s*=\s*mapped_column\(([^)]*)\)/;

function parseColumnLine(line: string): SqlAlchemyField | null {
  const mapped = line.match(MAPPED_COLUMN_RE);
  if (mapped) {
    const name = mapped[1]!;
    const innerType = mapped[2]!.trim();
    const args = mapped[3] ?? "";
    const required = !/nullable\s*=\s*True/.test(args) && !/^Optional\[/.test(innerType);
    return { name, type: innerType, required, description: "" };
  }
  const legacy = line.match(LEGACY_COLUMN_RE);
  if (legacy) {
    const name = legacy[1]!;
    const innerType = legacy[2]!.trim();
    const args = legacy[3] ?? "";
    const required = !/nullable\s*=\s*True/.test(args);
    return { name, type: innerType, required, description: "" };
  }
  return null;
}
