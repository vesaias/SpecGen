/**
 * Core spec types for SpecGen.
 *
 * These mirror the shape produced by the legacy specgen/index.ts --format unified pipeline.
 * The Spec is the single source of truth for a project's generated documentation.
 */

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

export interface TreeNode {
  /** Unique id — either a folder id or a SpecItem id */
  id: string;
  /** 'folder' is a structural grouping; the rest map to SpecItem types */
  type: "folder" | "backend" | "frontend" | "event" | "handler";
  /** Display label (folder nodes always have one; item nodes inherit from SpecItem.title) */
  label?: string;
  /** Child nodes (folders only) */
  children?: TreeNode[];
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export interface SpecMeta {
  /** Human-readable project / target name */
  target: string;
  /** Semver-like version string, e.g. "v2026.05.09" */
  version: string;
  /** ISO-8601 timestamp of when the spec was generated */
  generatedAt: string;
  /** Path to the backend source directory (relative to project root) */
  backendDir?: string;
  /** Path to the frontend source directory (relative to project root) */
  frontendDir?: string;
  /** Stats from the last run */
  lastRun?: {
    at: string;
    changed: number;
    added: number;
    unchanged: number;
  };
  /** Forward-compat extension bag */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Shared base across all spec item types */
interface SpecItemBase {
  id: string;
  type: "backend" | "frontend" | "event" | "handler";
  title: string;
  /** Tiptap doc JSON, stringified — present when the webapp has rendered it */
  content?: string;
  /** Source files that contributed to this item */
  sourceFiles?: string[];
  /** SHA-256 (first 16 chars) of source files — used to short-circuit merge on re-parse */
  sourceHash?: string;
  /**
   * Value of `sourceHash` at the time this item was last AI-enriched.
   * Drift detector: when `sourceHash !== enrichedSourceHash`, the source has changed
   * since the last successful enrichment and the item is a candidate for re-enrichment.
   * Preserved across mergeSpec; parsers never populate this — only the AI pipeline does.
   */
  enrichedSourceHash?: string;
}

export interface BackendSpecItem extends SpecItemBase {
  type: "backend";
  method: string;
  route: string;
  controller: string;
  summary: string;
  context: string;
  parameters: {
    name: string;
    location: "path" | "query" | "body" | "header";
    type: string;
    required: boolean;
    description: string;
  }[];
  requestBody?: {
    dtoName: string;
    fields: {
      name: string;
      type: string;
      required: boolean;
      description: string;
      validation?: string;
    }[];
  };
  responses: { status: number; type?: string; description: string; responseExample?: string }[];
  validationRules: { field: string; rule: string; message?: string }[];
  orchestration: { step: number; call: string; description: string }[];
  dependencies: string[];
}

export interface FrontendSpecItem extends SpecItemBase {
  type: "frontend";
  route: string;
  context: string;
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
  apiCalls: {
    hook: string;
    type: "REST" | "GraphQL";
    endpoint: string;
    method: string;
  }[];
  /**
   * Relative path (rooted at the project's data dir) of a screenshot captured
   * for this page. Populated by the frontend-capture generator; served by the
   * server's static captures route at `/data/projects/:slug/captures/:file`.
   */
  screenshot?: string;
  /**
   * Network XHR/fetch calls observed at page load by the Playwright capture.
   * Side-by-side with the statically-parsed `apiCalls` for visual comparison.
   * Populated by the frontend-capture generator.
   */
  observedApiCalls?: {
    method: string;
    url: string;
    status: number;
  }[];
  /** HTTP status of the page navigation itself during the last capture. */
  captureNavStatus?: number | null;
  /** Heuristic: page looks like it failed auth (401/403 on nav or all XHRs). */
  captureAuthLikelyFailed?: boolean;
  /**
   * Structural regions the Playwright capture pulled out of the rendered DOM —
   * cards, tables, forms, lists — each with its heading, visible text, table
   * columns when applicable, and the interactive elements inside (buttons,
   * inputs, links). Feeds the AI enrichment prompt so the model can describe
   * what the page actually shows, not just what the source code suggests.
   */
  observedSections?: {
    selector: string;
    heading: string;
    type: "card" | "table" | "chart" | "form" | "list" | "other";
    visibleText: string;
    tableColumns?: string[];
    tableRowCount?: number;
    elements: {
      tag: string;
      type?: string;
      text: string;
      role?: string;
      disabled: boolean;
      href?: string;
      placeholder?: string;
    }[];
  }[];
  /** `document.title` at capture time. */
  observedTitle?: string;
  /** First H1/H2 on the landed page. */
  landedH1?: string;
  /** URL the SPA actually ended up on after hydration (differs from `route` on redirects). */
  landedUrl?: string;
  /**
   * Fingerprint of the latest capture observations (sha256 of a normalised
   * subset of observedSections + observedApiCalls). Bumps when the captured
   * page state changes; used by the AI enrichment drift gate to re-enrich an
   * item after a fresh capture even if the source code is unchanged.
   */
  captureHash?: string;
  /**
   * Value of `captureHash` at the time this item was last AI-enriched.
   * Parallel to `enrichedSourceHash` but tracking capture-data drift instead
   * of source-code drift. AI re-runs when captureHash !== enrichedCaptureHash.
   */
  enrichedCaptureHash?: string;
}

export interface EventSpecItem extends SpecItemBase {
  type: "event";
  summary: string;
  context: string;
  payload: { name: string; type: string; description: string }[];
  payloadExample: string;
  triggers: { service: string; method: string; endpoint: string }[];
  handler: string;
  handlerDescription: string;
  /** AI-written: plain-language description of what the payload carries. */
  payloadDescription?: string;
  /** AI-written: one-sentence summary of what raises this event. */
  triggerDescription?: string;
}

export interface HandlerSpecItem extends SpecItemBase {
  type: "handler";
  description: string;
  listensTo?: string[];
}

/**
 * Discriminated union of all spec item types.
 * Use the `type` field to narrow.
 */
export type SpecItem = BackendSpecItem | FrontendSpecItem | EventSpecItem | HandlerSpecItem;

// ---------------------------------------------------------------------------
// Block types (shared between webapp and exporter)
// ---------------------------------------------------------------------------

export type BlockType = "richtext" | "table" | "code" | "response" | "callout" | "image";

export interface TableData {
  /** Column header labels */
  columns: string[];
  /** Row data (each row is an array of cell strings) */
  rows: string[][];
}

export interface ResponseData {
  status: number;
  description: string;
  /** JSON code example */
  body: string;
}

export interface Block {
  id: string;
  type: BlockType;
  /** richtext: Tiptap JSON doc, stringified; code: raw code; callout: Tiptap JSON */
  content?: string;
  /** table blocks */
  table?: TableData;
  /** response blocks */
  responses?: ResponseData[];
  /** callout variant, code language, image src/alt, etc. */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Spec (the root document)
// ---------------------------------------------------------------------------

export interface Spec {
  meta: SpecMeta;
  tree: TreeNode[];
  /** Map of item id → SpecItem */
  items: Record<string, SpecItem>;
}
