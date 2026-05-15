/**
 * Walk a repo, group source files into logical units, fire AI calls in
 * parallel, and assemble a ParseResult.
 *
 * The grouping in v1 is intentionally simple: one source file = one logical
 * unit. Over-splitting is fine — the spec layer coalesces by `id` (which is
 * derived from method + route / page name), so a controller spread across
 * three files just produces three calls that all extract the same endpoints
 * (last write wins, but they're identical).
 */
import {
  type AiClient,
  type BackendSpec,
  type EventSpec,
  type FrontendSpec,
  type ParseInput,
  type ParseResult,
  type ParserFileSystem,
  safeParseJson,
} from "@specgen/core";
import PQueue from "p-queue";
import { IGNORE_DIRS, classifyFile, isSourceFile } from "./heuristics.js";
import { backendPrompt, frontendPrompt } from "./prompts.js";
import type { LlmParserMode, LlmParserOpts } from "./types.js";

const DEFAULT_PER_FILE_BYTES = 32_000;
// Raised from 256 KB (which routinely starved frontend on medium repos) — the
// total cap is split per-kind below, so this is the SUM of backend + frontend.
const DEFAULT_TOTAL_BYTES = 1_500_000;
const DEFAULT_CONCURRENCY = 3;
const MAX_FILES_PER_RUN = 1_000;

interface Unit {
  path: string;
  kind: "backend" | "frontend";
  content: string;
}

function pickModel(client: AiClient, requested: string | undefined): string {
  if (requested) return requested;
  const fallback = client.models[0]?.id;
  if (!fallback) {
    throw new Error(
      `@specgen/parser-llm: AI client provider="${client.provider}" advertises no models; pass aiModel explicitly`,
    );
  }
  return fallback;
}

function buildSkipSet(ruleParserOutput: ParseResult | undefined): Set<string> {
  const skip = new Set<string>();
  if (!ruleParserOutput) return skip;
  const addAll = (items: { sourceFiles?: string[] }[] | undefined) => {
    if (!items) return;
    for (const item of items) {
      if (Array.isArray(item.sourceFiles)) {
        for (const f of item.sourceFiles) skip.add(normalisePath(f));
      }
    }
  };
  addAll(ruleParserOutput.endpoints);
  addAll(ruleParserOutput.pages);
  addAll(ruleParserOutput.events);
  return skip;
}

function normalisePath(p: string): string {
  return p.replace(/\\/g, "/");
}

async function collectUnits(
  fsys: ParserFileSystem,
  opts: { perFileBytes: number; totalBytes: number; mode: LlmParserMode; skip: Set<string> },
  warnings: string[],
): Promise<Unit[]> {
  // Split the byte budget per-kind so backend can't starve frontend (or vice
  // versa) on repos where walk-order is dominated by one side. Each bucket
  // gets half the total. Files of a kind whose bucket is full are skipped
  // even when the OTHER bucket still has headroom — a kind-imbalance warning
  // is emitted so the operator knows to raise totalBytes.
  const perKindBudget = Math.floor(opts.totalBytes / 2);
  const out: Unit[] = [];
  const bytesUsed: Record<"backend" | "frontend", number> = { backend: 0, frontend: 0 };
  const filesSkipped: Record<"backend" | "frontend", number> = { backend: 0, frontend: 0 };
  let scanned = 0;

  for await (const entry of fsys.walk("", { ignore: IGNORE_DIRS })) {
    if (entry.isDirectory) continue;
    if (!isSourceFile(entry.path)) continue;
    scanned++;
    if (scanned > MAX_FILES_PER_RUN) {
      warnings.push(
        `parser-llm: hit per-run file scan cap (${MAX_FILES_PER_RUN}); some files were not considered`,
      );
      break;
    }

    const kind = classifyFile(entry.path);
    if (kind === "skip") continue;

    if (opts.mode === "fallback" && opts.skip.has(normalisePath(entry.path))) continue;

    if (bytesUsed[kind] >= perKindBudget) {
      filesSkipped[kind]++;
      continue;
    }

    let content: string;
    try {
      content = await fsys.readFile(entry.path);
    } catch (err) {
      warnings.push(`parser-llm: could not read ${entry.path}: ${(err as Error).message}`);
      continue;
    }
    if (content.length > opts.perFileBytes) {
      content = content.slice(0, opts.perFileBytes);
    }
    bytesUsed[kind] += content.length;
    out.push({ path: entry.path, kind, content });
  }

  for (const k of ["backend", "frontend"] as const) {
    if (filesSkipped[k] > 0) {
      warnings.push(
        `parser-llm: ${k} byte budget exhausted (${perKindBudget} of ${opts.totalBytes} total) — ${filesSkipped[k]} ${k} file(s) skipped. Raise opts.totalBytes to capture more.`,
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// JSON shape coercion — the model often gets close but not exact.
// ---------------------------------------------------------------------------

function asArray(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

function coerceBackend(raw: unknown, sourceFile: string): BackendSpec[] {
  const arr = asArray(raw);
  const out: BackendSpec[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const method = typeof r.method === "string" ? r.method.toUpperCase() : "";
    const route = typeof r.route === "string" ? r.route : "";
    if (!method || !route) continue;
    out.push({
      endpoint: typeof r.endpoint === "string" ? r.endpoint : `${method} ${route}`,
      method,
      route,
      controller: typeof r.controller === "string" ? r.controller : "",
      summary: typeof r.summary === "string" ? r.summary : "",
      context: typeof r.context === "string" ? r.context : "",
      parameters: (asArray(r.parameters) as Record<string, unknown>[]).map((p) => ({
        name: String(p.name ?? ""),
        location:
          p.location === "path" ||
          p.location === "query" ||
          p.location === "body" ||
          p.location === "header"
            ? p.location
            : "query",
        type: String(p.type ?? "unknown"),
        required: Boolean(p.required),
        description: typeof p.description === "string" ? p.description : "",
      })),
      requestBody:
        r.requestBody && typeof r.requestBody === "object"
          ? coerceRequestBody(r.requestBody as Record<string, unknown>)
          : undefined,
      responses: (asArray(r.responses) as Record<string, unknown>[]).map((p) => ({
        status: typeof p.status === "number" ? p.status : Number(p.status) || 200,
        type: typeof p.type === "string" ? p.type : undefined,
        description: typeof p.description === "string" ? p.description : "",
      })),
      validationRules: (asArray(r.validationRules) as Record<string, unknown>[]).map((p) => ({
        field: String(p.field ?? ""),
        rule: String(p.rule ?? ""),
        message: typeof p.message === "string" ? p.message : undefined,
      })),
      orchestration: (asArray(r.orchestration) as Record<string, unknown>[]).map((p) => ({
        step: typeof p.step === "number" ? p.step : Number(p.step) || 0,
        call: String(p.call ?? ""),
        description: typeof p.description === "string" ? p.description : "",
      })),
      dependencies: (asArray(r.dependencies) as unknown[]).map((d) => String(d)),
      sourceFiles: dedupeSourceFiles(asArray(r.sourceFiles) as unknown[], sourceFile),
    });
  }
  return out;
}

function coerceRequestBody(r: Record<string, unknown>) {
  return {
    dtoName: typeof r.dtoName === "string" ? r.dtoName : "Body",
    fields: (asArray(r.fields) as Record<string, unknown>[]).map((f) => ({
      name: String(f.name ?? ""),
      type: String(f.type ?? "unknown"),
      required: Boolean(f.required),
      description: typeof f.description === "string" ? f.description : "",
      validation: typeof f.validation === "string" ? f.validation : undefined,
    })),
  };
}

function coerceEvents(raw: unknown, sourceFile: string): EventSpec[] {
  const arr = asArray(raw);
  const out: EventSpec[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    if (!name) continue;
    out.push({
      name,
      summary: typeof r.summary === "string" ? r.summary : "",
      context: typeof r.context === "string" ? r.context : "",
      payload: (asArray(r.payload) as Record<string, unknown>[]).map((p) => ({
        name: String(p.name ?? ""),
        type: String(p.type ?? "unknown"),
        description: typeof p.description === "string" ? p.description : "",
      })),
      payloadExample: typeof r.payloadExample === "string" ? r.payloadExample : "",
      triggers: (asArray(r.triggers) as Record<string, unknown>[]).map((p) => ({
        service: String(p.service ?? ""),
        method: String(p.method ?? ""),
        endpoint: String(p.endpoint ?? ""),
      })),
      handler: typeof r.handler === "string" ? r.handler : "",
      handlerDescription: typeof r.handlerDescription === "string" ? r.handlerDescription : "",
      sourceFiles: dedupeSourceFiles(asArray(r.sourceFiles) as unknown[], sourceFile),
    });
  }
  return out;
}

function coerceFrontend(raw: unknown, sourceFile: string): FrontendSpec[] {
  const arr = asArray(raw);
  const out: FrontendSpec[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const page = typeof r.page === "string" ? r.page : "";
    if (!page) continue;
    out.push({
      page,
      route: typeof r.route === "string" ? r.route : "",
      context: typeof r.context === "string" ? r.context : "",
      sourceFiles: dedupeSourceFiles(asArray(r.sourceFiles) as unknown[], sourceFile),
      sections: (asArray(r.sections) as Record<string, unknown>[]).map((s) => ({
        id: String(s.id ?? ""),
        component: String(s.component ?? ""),
        elements: (asArray(s.elements) as Record<string, unknown>[]).map((el) => ({
          tag: String(el.tag ?? ""),
          type: typeof el.type === "string" ? el.type : undefined,
          name: typeof el.name === "string" ? el.name : undefined,
          placeholder: typeof el.placeholder === "string" ? el.placeholder : undefined,
          ariaLabel: typeof el.ariaLabel === "string" ? el.ariaLabel : undefined,
          disabled: typeof el.disabled === "string" ? el.disabled : undefined,
          editable: Boolean(el.editable),
          source: typeof el.source === "string" ? el.source : "",
          text: typeof el.text === "string" ? el.text : undefined,
        })),
      })),
      navigation: (asArray(r.navigation) as Record<string, unknown>[]).map((n) => ({
        to: String(n.to ?? ""),
        trigger: String(n.trigger ?? ""),
        condition: String(n.condition ?? ""),
      })),
      actions: (asArray(r.actions) as Record<string, unknown>[]).map((a) => ({
        trigger: String(a.trigger ?? ""),
        endpoint: typeof a.endpoint === "string" ? a.endpoint : undefined,
        method: typeof a.method === "string" ? a.method : undefined,
        requestBody: typeof a.requestBody === "string" ? a.requestBody : undefined,
        onSuccess: typeof a.onSuccess === "string" ? a.onSuccess : undefined,
        onError: typeof a.onError === "string" ? a.onError : undefined,
        clientValidation: Array.isArray(a.clientValidation)
          ? a.clientValidation.map(String)
          : undefined,
      })),
      state: (asArray(r.state) as Record<string, unknown>[]).map((s) => ({
        name: String(s.name ?? ""),
        type: String(s.type ?? "unknown"),
        initialValue: String(s.initialValue ?? ""),
      })),
      apiCalls: (asArray(r.apiCalls) as Record<string, unknown>[]).map((c) => ({
        hook: String(c.hook ?? ""),
        type: c.type === "GraphQL" ? "GraphQL" : "REST",
        endpoint: String(c.endpoint ?? ""),
        method: String(c.method ?? "GET"),
      })),
    });
  }
  return out;
}

function dedupeSourceFiles(raw: unknown[], fallback: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const n = normalisePath(v);
    if (n && !seen.has(n)) {
      seen.add(n);
      result.push(n);
    }
  }
  if (result.length === 0) result.push(normalisePath(fallback));
  return result;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function parseRepo(input: ParseInput): Promise<ParseResult> {
  const opts: LlmParserOpts = ((input.config ?? {}) as { llm?: LlmParserOpts }).llm ?? {};
  const mode: LlmParserMode = opts.mode ?? "fallback";
  const perFileBytes = opts.perFileBytes ?? DEFAULT_PER_FILE_BYTES;
  const totalBytes = opts.totalBytes ?? DEFAULT_TOTAL_BYTES;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  const warnings: string[] = [];

  if (!input.aiClient) {
    warnings.push(
      "parser-llm: no aiClient provided in ParseInput — the LLM parser cannot run. Configure an AI provider on the project.",
    );
    return { endpoints: [], pages: [], events: [], warnings };
  }

  const skip = buildSkipSet(input.ruleParserOutput);
  const units = await collectUnits(input.fs, { perFileBytes, totalBytes, mode, skip }, warnings);

  if (units.length === 0) {
    return { endpoints: [], pages: [], events: [], warnings };
  }

  const model = pickModel(input.aiClient, input.aiModel);
  const queue = new PQueue({ concurrency: Math.max(1, concurrency) });

  const endpoints: BackendSpec[] = [];
  const events: EventSpec[] = [];
  const pages: FrontendSpec[] = [];

  const tasks = units.map((unit) =>
    queue.add(async () => {
      const system = unit.kind === "backend" ? backendPrompt() : frontendPrompt();
      const prompt = renderUserPrompt(unit);
      try {
        const result = await input.aiClient!.complete({
          prompt,
          system,
          model,
          temperature: 0,
          maxTokens: 4_000,
        });
        const parsed = safeParseJson(result.text);
        if (!parsed || typeof parsed !== "object") {
          warnings.push(`parser-llm: ${unit.path}: AI response was not parseable JSON`);
          return;
        }
        const obj = parsed as Record<string, unknown>;
        if (unit.kind === "backend") {
          endpoints.push(...coerceBackend(obj.endpoints, unit.path));
          events.push(...coerceEvents(obj.events, unit.path));
        } else {
          pages.push(...coerceFrontend(obj.pages, unit.path));
        }
      } catch (err) {
        warnings.push(`parser-llm: ${unit.path}: AI call failed: ${(err as Error).message}`);
      }
    }),
  );

  await Promise.all(tasks);

  // Fill in missing page routes from router declarations. Pages parsed in
  // isolation (one file at a time) can't see the central router file, so the
  // AI often returns route="". Scan ALL collected unit content for common
  // React Router patterns and back-fill.
  const routesByComponent = extractRoutesByComponent(units);
  for (const page of pages) {
    if (!page.route) {
      const r = routesByComponent.get(page.page);
      if (r) page.route = r;
    }
  }

  return { endpoints, pages, events, warnings };
}

/**
 * Scan unit content for component→route declarations and return a map of
 * componentName → route. Handles the common React Router shapes:
 *
 *   <Route path="/foo" element={<FooPage />} />     (RR v6)
 *   <Route path="/foo" component={FooPage} />       (RR v5)
 *   <Route path="/foo" render={() => <FooPage />} /> (RR v5 render prop)
 *   { path: "/foo", element: <FooPage /> }          (object route config)
 *   { path: "/foo", component: FooPage }            (object route config)
 *
 * Quotes can be single, double, or template literals. Whitespace tolerant.
 * Order-insensitive: we scan each pattern twice — once with path first, once
 * with the component reference first.
 */
function extractRoutesByComponent(units: Unit[]): Map<string, string> {
  const map = new Map<string, string>();
  const add = (component: string, route: string) => {
    if (!component || !route) return;
    if (!map.has(component)) map.set(component, route);
  };

  // Each entry: regex matching one declaration form, plus a function that
  // pulls (component, route) out of the match groups.
  const g = (m: RegExpExecArray, i: number): string => m[i] ?? "";
  const patterns: Array<{ re: RegExp; pick: (m: RegExpExecArray) => [string, string] }> = [
    // <Route path="/x" element={<Foo />} />
    {
      re: /<Route\b[^>]*\bpath\s*=\s*["'`]([^"'`]+)["'`][^>]*\belement\s*=\s*\{\s*<\s*(\w+)\b/g,
      pick: (m) => [g(m, 2), g(m, 1)],
    },
    // <Route element={<Foo />} path="/x" />
    //
    // After capturing the component reference inside `element={...}`, we
    // need to skip past the `>` of a self-closing JSX element (`<Foo />`)
    // and the closing `}` of the expression value before reaching `path=`.
    // The original `[^>]*` here stopped at that `>` — so this pattern was
    // dead for the most common RR v6 shape. Switch to balanced `\{[^}]*\}`
    // semantics: consume the JSX expression value as a whole, then continue
    // scanning attributes (no `>` until the route's own closing tag).
    {
      re: /<Route\b[^>]*?\belement\s*=\s*\{[^}]*?<\s*(\w+)\b[^}]*?\}[^>]*?\bpath\s*=\s*["'`]([^"'`]+)["'`]/g,
      pick: (m) => [g(m, 1), g(m, 2)],
    },
    // <Route path="/x" component={Foo} />
    {
      re: /<Route\b[^>]*\bpath\s*=\s*["'`]([^"'`]+)["'`][^>]*\bcomponent\s*=\s*\{\s*(\w+)\s*\}/g,
      pick: (m) => [g(m, 2), g(m, 1)],
    },
    // <Route component={Foo} path="/x" />
    {
      re: /<Route\b[^>]*\bcomponent\s*=\s*\{\s*(\w+)\s*\}[^>]*\bpath\s*=\s*["'`]([^"'`]+)["'`]/g,
      pick: (m) => [g(m, 1), g(m, 2)],
    },
    // <Route path="/x" render={() => <Foo …/>} />
    {
      re: /<Route\b[^>]*\bpath\s*=\s*["'`]([^"'`]+)["'`][^>]*\brender\s*=\s*\{[^}]*<\s*(\w+)\b/g,
      pick: (m) => [g(m, 2), g(m, 1)],
    },
    // { path: "/x", element: <Foo /> }
    {
      re: /\bpath\s*:\s*["'`]([^"'`]+)["'`]\s*,\s*element\s*:\s*<\s*(\w+)\b/g,
      pick: (m) => [g(m, 2), g(m, 1)],
    },
    // { element: <Foo />, path: "/x" }
    {
      re: /\belement\s*:\s*<\s*(\w+)\b[^,]*,\s*path\s*:\s*["'`]([^"'`]+)["'`]/g,
      pick: (m) => [g(m, 1), g(m, 2)],
    },
    // { path: "/x", component: Foo }
    {
      re: /\bpath\s*:\s*["'`]([^"'`]+)["'`]\s*,\s*component\s*:\s*(\w+)\b/g,
      pick: (m) => [g(m, 2), g(m, 1)],
    },
    // { component: Foo, path: "/x" }
    {
      re: /\bcomponent\s*:\s*(\w+)\s*,\s*path\s*:\s*["'`]([^"'`]+)["'`]/g,
      pick: (m) => [g(m, 1), g(m, 2)],
    },
  ];

  for (const unit of units) {
    for (const { re, pick } of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(unit.content)) !== null) {
        const [comp, route] = pick(m);
        add(comp, route);
      }
    }
  }
  return map;
}

function renderUserPrompt(unit: Unit): string {
  return [`File: ${unit.path}`, "", "Source code:", "```", unit.content, "```"].join("\n");
}
