import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "path";
import { GitHubFs, GitHubSubFs, type ParserFileSystem, hydrateForTsMorph } from "@specgen/core";
import { Project, type SourceFile } from "ts-morph";

export interface FrontendSpec {
  page: string;
  route: string;
  context: string;
  sourceFiles: string[];
  sections: {
    id: string;
    component: string;
    elements: {
      tag: string;
      type?: string;
      name?: string;
      placeholder?: string;
      ariaLabel?: string;
      disabled?: string;
      editable: boolean;
      source: string;
      text?: string;
    }[];
  }[];
  navigation: { to: string; trigger: string; condition: string }[];
  actions: {
    trigger: string;
    endpoint?: string;
    method?: string;
    requestBody?: string;
    onSuccess?: string;
    onError?: string;
    clientValidation?: string[];
  }[];
  state: { name: string; type: string; initialValue: string }[];
  apiCalls: { hook: string; type: "REST" | "GraphQL"; endpoint: string; method: string }[];
}

// Convert an absolute path to a forward-slash path relative to fsys.rootDir.
// Uses path.sep so the split works correctly on both win32 (backslash) and
// posix (forward slash) without relying on a regex that only handles win32.
function toFsysRel(rootDir: string, absPath: string): string {
  return path.relative(rootDir, absPath).split(path.sep).join("/");
}

// Recursively find files matching a pattern, using ParserFileSystem.
// `relDir` is relative to fsys.rootDir. Returns absolute paths anchored at
// `tsMorphRoot` (which is fsys.rootDir for LocalFs, or the hydrated temp dir
// for GitHubFs) so callers can pass them straight to ts-morph's
// `project.getSourceFile()`.
async function findFiles(
  fsys: ParserFileSystem,
  relDir: string,
  test: (name: string) => boolean,
  tsMorphRoot: string,
): Promise<string[]> {
  if (!(await fsys.exists(relDir))) return [];
  const results: string[] = [];
  for await (const entry of fsys.walk(relDir, {
    ignore: ["node_modules", "dist", ".next", "build", ".vite"],
  })) {
    if (entry.isDirectory) continue;
    const name = path.basename(entry.path);
    if (test(name)) {
      results.push(path.join(tsMorphRoot, entry.path));
    }
  }
  return results;
}

// Parse router files to extract route → component mappings
// Handles multiple patterns: createBrowserRouter, RouteObject[], <Route>, etc.
async function parseRoutes(
  fsys: ParserFileSystem,
  project: Project,
  tsMorphRoot: string,
): Promise<Map<string, { component: string; file: string }>> {
  const routes = new Map<string, { component: string; file: string }>();

  // Find any file that might contain routes (absolute paths under tsMorphRoot).
  // Accept TS and JS variants — JobNavigator and similar projects use plain
  // JSX without a TypeScript toolchain.
  const srcRelDir = "src";
  const candidates = await findFiles(
    fsys,
    srcRelDir,
    (name) =>
      /route/i.test(name) &&
      (name.endsWith(".tsx") ||
        name.endsWith(".ts") ||
        name.endsWith(".jsx") ||
        name.endsWith(".js")),
    tsMorphRoot,
  );
  // Also check App.{tsx,jsx,ts,js} and main.{tsx,jsx,ts,js} — common spots
  // for top-level <Routes>/<RouterProvider> usage.
  for (const rel of [
    "src/App.tsx",
    "src/App.jsx",
    "src/App.ts",
    "src/App.js",
    "src/main.tsx",
    "src/main.jsx",
    "src/main.ts",
    "src/main.js",
  ]) {
    if (await fsys.exists(rel)) candidates.push(path.join(tsMorphRoot, rel));
  }

  for (const rf of candidates) {
    const src = project.getSourceFile(rf);
    if (!src) continue;
    const text = src.getFullText();

    // Pattern 1: { path: '...', element: <Component ... /> }
    const routeRegex = /path:\s*['"]([^'"]+)['"]\s*,\s*element:\s*<(\w+)/g;
    let m;
    while ((m = routeRegex.exec(text)) !== null) {
      if (["Navigate", "RequireAuth", "App"].includes(m[2]!)) continue;
      routes.set(m[1]!, { component: m[2]!, file: rf });
    }

    // Pattern 2: <Route path="..." element={<Component />} />
    const jsxRouteRegex = /<Route\s+path=["']([^"']+)["']\s+element=\{<(\w+)/g;
    while ((m = jsxRouteRegex.exec(text)) !== null) {
      if (m[2] !== "Navigate") {
        routes.set(m[1]!, { component: m[2]!, file: rf });
      }
    }
  }

  // Resolve component imports to find actual file paths
  for (const [, info] of routes) {
    for (const rf of candidates) {
      const src = project.getSourceFile(rf);
      if (!src) continue;
      const text = src.getFullText();
      // Find import for this component: import Foo from "..."  or  import { Foo } from "..."
      const importRegex = new RegExp(
        `import\\s+(?:\\{\\s*)?${info.component}(?:\\s*\\})?\\s+from\\s+["']([^"']+)["']`,
      );
      const im = text.match(importRegex);
      if (im) {
        const importPath = im[1]!;
        const resolved = path.resolve(path.dirname(rf), importPath);
        // Try .tsx, .ts, /index.tsx — convert to relative path for fsys.exists.
        // Paths here live under tsMorphRoot (which is fsys.rootDir for LocalFs
        // or the hydrated temp dir for GitHubFs); both layouts mirror the same
        // tree structure, so the rel path is valid for fsys lookups either way.
        for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
          const candidate = resolved + ext;
          const candidateRel = toFsysRel(tsMorphRoot, candidate);
          if (await fsys.exists(candidateRel)) {
            info.file = candidate;
            break;
          }
        }
        // If the import path already has extension
        const resolvedRel = toFsysRel(tsMorphRoot, resolved);
        if (await fsys.exists(resolvedRel)) {
          info.file = resolved;
        }
        break;
      }
    }
  }

  return routes;
}

// Extract JSX interactive elements from a source file
function extractElements(src: SourceFile): FrontendSpec["sections"][0]["elements"] {
  const elements: FrontendSpec["sections"][0]["elements"] = [];
  const text = src.getFullText();

  const interactiveTags = ["input", "button", "a", "select", "textarea"];

  for (const tag of interactiveTags) {
    const selfCloseRegex = new RegExp(`<${tag}\\b([^>]*?)\\/>`, "gs");
    let m;
    while ((m = selfCloseRegex.exec(text)) !== null) {
      elements.push(parseJsxProps(tag, m[1]!));
    }

    const openRegex = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gs");
    while ((m = openRegex.exec(text)) !== null) {
      const el = parseJsxProps(tag, m[1]!);
      const textContent = m[2]!
        .replace(/<[^>]+>/g, "")
        .replace(/\{[^}]+\}/g, "")
        .trim();
      if (textContent) el.text = textContent.slice(0, 100);
      elements.push(el);
    }
  }

  // Also match common UI library components: Button, Input, Form.Input, etc.
  const uiComponentRegex =
    /<(Button|Input|TextArea|Select|Checkbox|Form\.Input|Form\.TextArea|Form\.Select)\b([^>]*?)(?:\/>|>([^<]*)<)/gs;
  let uim;
  while ((uim = uiComponentRegex.exec(text)) !== null) {
    const tag = uim[1]!;
    const el = parseJsxProps(tag.toLowerCase().replace("form.", ""), uim[2]!);
    if (uim[3]) el.text = uim[3].trim().slice(0, 100);
    elements.push(el);
  }

  // Find Link/NavLink components
  const linkRegex = /<(?:Link|NavLink)\s+to=\{?["'`]?([^"'`}\s>]+)["'`]?\}?[^>]*>([^<]*)/g;
  let lm;
  while ((lm = linkRegex.exec(text)) !== null) {
    elements.push({
      tag: "Link",
      source: "navigation",
      editable: false,
      text: lm[2]!.trim().slice(0, 100) || undefined,
      name: lm[1],
    });
  }

  return elements;
}

function parseJsxProps(tag: string, attrStr: string): FrontendSpec["sections"][0]["elements"][0] {
  const el: FrontendSpec["sections"][0]["elements"][0] = {
    tag,
    editable: ["input", "textarea", "select"].includes(tag),
    source: ["input", "textarea"].includes(tag) ? "user input" : "static",
  };

  const typeMatch = attrStr.match(/type=["']([^"']+)["']/);
  if (typeMatch) el.type = typeMatch[1];

  const nameMatch = attrStr.match(/name=["']([^"']+)["']/);
  if (nameMatch) el.name = nameMatch[1];

  const placeholderMatch = attrStr.match(/placeholder=["']([^"']+)["']/);
  if (placeholderMatch) el.placeholder = placeholderMatch[1];

  const ariaMatch = attrStr.match(/aria-label=["']([^"']+)["']/);
  if (ariaMatch) el.ariaLabel = ariaMatch[1];

  const disabledMatch = attrStr.match(/disabled(?:=\{([^}]+)\})?/);
  if (disabledMatch) el.disabled = disabledMatch[1] ?? "true";

  if (tag === "button" && el.type !== "submit") el.editable = false;
  if (tag === "a") {
    el.editable = false;
    el.source = "navigation";
  }

  return el;
}

// Extract useState declarations
function extractState(src: SourceFile): FrontendSpec["state"] {
  const state: FrontendSpec["state"] = [];
  const text = src.getFullText();

  const useStateRegex = /const\s+\[(\w+),\s*set\w+\]\s*=\s*useState(?:<([^>]+)>)?\(([^)]*)\)/g;
  let m;
  while ((m = useStateRegex.exec(text)) !== null) {
    state.push({
      name: m[1]!,
      type: m[2] ?? "unknown",
      initialValue: m[3]!.replace(/['"`]/g, "") || "undefined",
    });
  }

  return state;
}

// Extract navigation calls
function extractNavigation(src: SourceFile): FrontendSpec["navigation"] {
  const nav: FrontendSpec["navigation"] = [];
  const text = src.getFullText();

  const navRegex = /navigate\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = navRegex.exec(text)) !== null) {
    nav.push({ to: m[1]!, trigger: "programmatic navigation", condition: "[TODO]" });
  }

  // Template literal navigate: navigate(`/activities/${id}`)
  const templateNavRegex = /navigate\(\s*`([^`]+)`/g;
  while ((m = templateNavRegex.exec(text)) !== null) {
    const to = m[1]!.replace(/\$\{[^}]+\}/g, ":param");
    if (!nav.find((n) => n.to === to)) {
      nav.push({ to, trigger: "programmatic navigation", condition: "[TODO]" });
    }
  }

  const linkRegex = /<(?:Link|NavLink)\s+to=\{?["'`]([^"'`}]+)["'`]\}?/g;
  while ((m = linkRegex.exec(text)) !== null) {
    nav.push({ to: m[1]!, trigger: "Link click", condition: "always" });
  }

  return nav;
}

// Extract API calls — supports custom hooks, MobX store calls, and direct axios/fetch
async function extractApiCalls(
  fsys: ParserFileSystem,
  src: SourceFile,
  project: Project,
  frontendDir: string,
  tsMorphRoot: string,
): Promise<FrontendSpec["apiCalls"]> {
  const calls: FrontendSpec["apiCalls"] = [];
  const text = src.getFullText();
  const seen = new Set<string>();

  // Pattern 1: Custom hooks (useXxx)
  const hookRegex = /(?:const\s+\{[^}]+\}\s*=\s*)?(use\w+)\s*\(/g;
  let m;
  while ((m = hookRegex.exec(text)) !== null) {
    const hookName = m[1]!;
    if (
      [
        "useState",
        "useEffect",
        "useParams",
        "useNavigate",
        "useLocation",
        "useRef",
        "useMemo",
        "useCallback",
        "useStore",
      ].includes(hookName)
    )
      continue;
    if (seen.has(hookName)) continue;
    seen.add(hookName);
    calls.push({ hook: hookName, type: "REST", endpoint: "[from hook]", method: "GET" });
  }

  // Pattern 2: MobX store method calls — e.g. activityStore.loadActivities()
  const storeCallRegex = /(\w+Store)\.(\w+)\s*\(/g;
  while ((m = storeCallRegex.exec(text)) !== null) {
    const key = `${m[1]}.${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ hook: key, type: "REST", endpoint: "[from store]", method: "GET" });
  }

  // Pattern 3: Direct fetch/axios calls
  const fetchRegex = /(?:fetch|axios)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = fetchRegex.exec(text)) !== null) {
    const key = `${m[1]} ${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({
      hook: `direct ${m[1]}`,
      type: "REST",
      endpoint: m[2]!,
      method: m[1]!.toUpperCase(),
    });
  }

  // Enrich hooks from hook files. ts-morph identifies SourceFiles by absolute
  // path — when running off a hydrated github checkout, `tsMorphRoot` is the
  // temp dir; for LocalFs it's the same as `frontendDir`. Either way the right
  // root for ts-morph lookups is `tsMorphRoot`.
  const hooksDir = path.join(tsMorphRoot, "src", "hooks");
  // `frontendDir` is intentionally unused here — keeping the param for callers
  // that still pass it positionally; the only resolution that mattered (hooks
  // file lookup) is now expressed in tsMorphRoot terms.
  void frontendDir;
  for (const call of calls) {
    if (!call.hook.startsWith("use")) continue;
    const hookFile = path.join(hooksDir, `${call.hook}.ts`);
    const hookSrc = project.getSourceFile(hookFile);
    if (!hookSrc) continue;
    const hookText = hookSrc.getFullText();

    if (hookText.includes("gql<") || hookText.includes("gql(")) {
      call.type = "GraphQL";
      const domainMatch = hookText.match(/gql[^(]*\(\s*['"](\w+)['"]/);
      if (domainMatch) call.endpoint = `/graphql/${domainMatch[1]}`;
      call.method = "POST";
    } else if (hookText.includes("get<") || hookText.includes("get(")) {
      call.type = "REST";
      const pathMatch = hookText.match(/get[^(]*\(\s*[`'"]([\w/.${}\-:]+)[`'"]/);
      if (pathMatch) call.endpoint = pathMatch[1]!;
      call.method = "GET";
    } else if (hookText.includes("post<") || hookText.includes("post(")) {
      call.type = "REST";
      const pathMatch = hookText.match(/post[^(]*\(\s*[`'"]([\w/.${}\-:]+)[`'"]/);
      if (pathMatch) call.endpoint = pathMatch[1]!;
      call.method = "POST";
    }
  }

  // Enrich MobX store calls by finding the agent/API file
  const agentFiles = await findFiles(
    fsys,
    "src",
    (name) => /agent|api/i.test(name) && (name.endsWith(".ts") || name.endsWith(".tsx")),
    tsMorphRoot,
  );
  for (const af of agentFiles) {
    const agentSrc = project.getSourceFile(af);
    if (!agentSrc) continue;
    const agentText = agentSrc.getFullText();

    // Match axios method definitions: methodName: (params) => axios.get<T>('/url')
    const axiosRegex =
      /(\w+)\s*[:=]\s*(?:\([^)]*\)\s*=>)?\s*(?:requests|axios)\.(get|post|put|del|delete|patch)\s*(?:<[^>]+>)?\s*\(\s*[`'"](\/[^`'"]+)[`'"]/g;
    while ((m = axiosRegex.exec(agentText)) !== null) {
      const methodName = m[1]!;
      const httpMethod = m[2] === "del" ? "DELETE" : m[2]!.toUpperCase();
      const endpoint = m[3]!;

      // Match against store calls
      for (const call of calls) {
        if (call.hook.includes(`.${methodName}`) || call.hook.endsWith(methodName)) {
          call.endpoint = endpoint;
          call.method = httpMethod;
        }
      }
    }
  }

  return calls;
}

// Extract component imports to find sections — broader pattern matching
function extractSections(
  src: SourceFile,
  project: Project,
  _frontendDir: string,
): FrontendSpec["sections"] {
  const sections: FrontendSpec["sections"] = [];
  const text = src.getFullText();

  // Find all imported components (default and named imports from relative paths)
  const importRegex = /import\s+(?:(\w+)|(?:\{\s*([\w,\s]+)\s*\}))\s+from\s+['"](\.[^'"]+)['"]/g;
  let m;
  const usedComponents: { name: string; importPath: string }[] = [];
  while ((m = importRegex.exec(text)) !== null) {
    const names = m[1]
      ? [m[1]]
      : (m[2] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    for (const name of names) {
      if (["observer", "useStore", "React"].includes(name)) continue;
      usedComponents.push({ name, importPath: m[3]! });
    }
  }

  const srcDir = path.dirname(src.getFilePath());

  for (const comp of usedComponents) {
    // Skip layout/shell components
    if (["Layout", "Navbar", "App", "RequireAuth"].includes(comp.name)) continue;

    // Resolve the import path
    const resolved = path.resolve(srcDir, comp.importPath);
    let compSrc: SourceFile | undefined;
    for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts", ""]) {
      compSrc = project.getSourceFile(resolved + ext);
      if (compSrc) break;
    }

    const elements = compSrc ? extractElements(compSrc) : [];

    sections.push({
      id: comp.name
        .replace(/([A-Z])/g, "-$1")
        .toLowerCase()
        .replace(/^-/, ""),
      component: comp.name,
      elements,
    });
  }

  // Add page-level elements
  const pageElements = extractElements(src);
  if (pageElements.length > 0) {
    sections.unshift({
      id: "page-level",
      component: path.basename(src.getFilePath(), ".tsx"),
      elements: pageElements,
    });
  }

  return sections;
}

export async function parseFrontend(
  frontendDir: string,
  fsys: ParserFileSystem,
): Promise<FrontendSpec[]> {
  // Plain JS-only React projects (no TypeScript) won't have a tsconfig.
  // Don't bail — we'll synthesize compiler options below.
  const hasTsConfig = await fsys.exists("tsconfig.json");

  // When source comes from GitHubFs (no real disk), hydrate .ts*/tsconfig.json
  // files to a temp dir so ts-morph + the TypeScript compiler can resolve
  // modules + tsconfig normally. LocalFs's rootDir is already an absolute disk
  // path, so we use it directly.
  let tsMorphRoot: string;
  let cleanup: () => void = () => {};
  if (fsys instanceof GitHubFs || fsys instanceof GitHubSubFs) {
    const commitSha = fsys.resolvedCommitSha ?? "unresolved";
    const dir = mkdtempSync(path.join(tmpdir(), `specgen-hydrate-${commitSha.slice(0, 8)}-`));
    // When the FS is a GitHubSubFs (parser was already given a sub-rooted view,
    // e.g. /frontend), the hydration walk is already scoped at the right level
    // — pass empty rootRel so hydrateForTsMorph writes from the sub-root. For
    // a top-level GitHubFs, scope to frontendDir so we only fetch the relevant
    // subset of blobs.
    const rootRel = fsys instanceof GitHubSubFs ? "" : frontendDir;
    // Include .js / .jsx so JSX-only projects (no TypeScript) hydrate cleanly.
    tsMorphRoot = await hydrateForTsMorph(fsys, dir, {
      rootRel,
      extensions: [".ts", ".tsx", ".d.ts", ".js", ".jsx"],
    });
    cleanup = () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort — temp dir leak on Windows-locked files is tolerable
      }
    };
  } else {
    // LocalFs path — fsys.rootDir is an absolute disk path. frontendDir is the
    // sub-frontend directory (e.g. `<repo>/frontend`); we keep it as the root
    // so ts-morph's tsconfig + glob match the existing LocalFs behaviour.
    tsMorphRoot = frontendDir;
  }

  try {
    const tsConfigPath = path.join(tsMorphRoot, "tsconfig.json");
    const project = hasTsConfig
      ? new Project({
          tsConfigFilePath: tsConfigPath,
          skipAddingFilesFromTsConfig: true,
        })
      : new Project({
          // JSX-only project (no tsconfig). Synthesize compiler options so
          // ts-morph can parse .jsx/.js files as React. Numeric constants
          // come from the TypeScript compiler API:
          //   target: ScriptTarget.ES2022 = 9
          //   module: ModuleKind.ESNext = 99
          //   jsx: JsxEmit.React = 2
          //   moduleResolution: ModuleResolutionKind.NodeJs = 2
          compilerOptions: {
            target: 9,
            module: 99,
            jsx: 2,
            allowJs: true,
            checkJs: false,
            esModuleInterop: true,
            moduleResolution: 2,
            skipLibCheck: true,
          },
        });

    // Add all source files — include .js / .jsx so JSX-only projects work.
    project.addSourceFilesAtPaths(path.join(tsMorphRoot, "src", "**", "*.{ts,tsx,js,jsx}"));

    const routes = await parseRoutes(fsys, project, tsMorphRoot);
    const specs: FrontendSpec[] = [];

    for (const [routePath, info] of routes) {
      // Try to find the page component file
      let src = project.getSourceFile(info.file);

      // If not found by resolved import, search by component name
      if (!src) {
        const searchDirs = ["pages", "features", "views", "screens"];
        for (const dir of searchDirs) {
          const found = await findFiles(
            fsys,
            `src/${dir}`,
            (name) =>
              name === `${info.component}.tsx` ||
              name === `${info.component}.ts` ||
              name === `${info.component}.jsx` ||
              name === `${info.component}.js`,
            tsMorphRoot,
          );
          if (found.length > 0) {
            src = project.getSourceFile(found[0]!);
            if (src) {
              info.file = found[0]!;
              break;
            }
          }
        }
      }

      if (!src) {
        console.warn(
          `  Warning: Could not find source for ${info.component} (route: ${routePath})`,
        );
        continue;
      }

      const relPath = path.relative(process.cwd(), info.file).replace(/\\/g, "/");

      const sections = extractSections(src, project, frontendDir);
      const navigation = extractNavigation(src);
      const state = extractState(src);
      const apiCalls = await extractApiCalls(fsys, src, project, frontendDir, tsMorphRoot);

      specs.push({
        page: info.component,
        route: routePath,
        context: "[TODO: Human fills]",
        sourceFiles: [relPath],
        sections,
        navigation,
        actions: [],
        state,
        apiCalls,
      });
    }

    return specs;
  } finally {
    cleanup();
  }
}
