import type { Block } from "@specgen/core";

// Tree node in sidebar
export interface TreeNode {
  id: string;
  type: "folder" | "backend" | "frontend" | "event" | "handler";
  label?: string;
  children?: TreeNode[];
}

export interface SpecJson {
  meta: {
    target: string;
    version: string;
    generatedAt: string;
    backendDir: string;
    frontendDir: string;
    lastRun?: { at: string };
  };
  tree: TreeNode[];
  items: Record<string, SpecItem>;
}

export type SpecItem = BackendItem | FrontendItem | EventItem;

export interface BackendItem {
  type: "backend";
  title: string;
  method: string;
  route: string;
  controller: string;
  summary: string;
  context: string;
  content: string;
  parameters: Parameter[];
  requestBody?: RequestBody;
  responses: Response[];
  validationRules: ValidationRule[];
  orchestration: OrchestrationStep[];
  dependencies: string[];
  sourceFiles: string[];
  sourceHash?: string;
  blocks?: Block[];
}

export interface FrontendItem {
  type: "frontend";
  title: string;
  route: string;
  context: string;
  content: string;
  sourceFiles: string[];
  sections: Section[];
  navigation: Navigation[];
  actions: Action[];
  state: StateField[];
  apiCalls: ApiCall[];
  /** AI-written: page summary in one line. */
  summary?: string;
  /** AI-written: one paragraph describing what happens at page load. */
  onLoadDescription?: string;
  /** AI-written: map keyed by section.id → plain-language description. */
  sectionDescriptions?: Record<string, string>;
  /** AI-written: map keyed by action.trigger → plain-language description. */
  actionDescriptions?: Record<string, string>;
  screenshot?: string;
  /**
   * Network XHR/fetch traffic observed during page-load by the
   * frontend-capture generator. Side-by-side with the statically-parsed
   * `apiCalls` for visual comparison.
   */
  observedApiCalls?: { method: string; url: string; status: number }[];
  /** Rendered-DOM regions captured by Playwright (heading, table cols, etc). */
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
  observedTitle?: string;
  landedH1?: string;
  landedUrl?: string;
  captureNavStatus?: number | null;
  captureAuthLikelyFailed?: boolean;
  sourceHash?: string;
  blocks?: Block[];
}

export interface EventItem {
  type: "event" | "handler";
  title: string;
  context: string;
  content: string;
  summary: string;
  payload: PayloadField[];
  payloadExample: string;
  triggers: Trigger[];
  handler: string;
  handlerDescription: string;
  sourceFiles: string[];
  sourceHash?: string;
  blocks?: Block[];
}

export interface Parameter {
  name: string;
  location: string;
  type: string;
  required: boolean;
  description: string;
}
export interface RequestBody {
  dtoName: string;
  fields: {
    name: string;
    type: string;
    required: boolean;
    description: string;
    validation?: string;
  }[];
}
export interface Response {
  status: number;
  type?: string;
  description: string;
  responseExample?: string;
}
export interface ValidationRule {
  field: string;
  rule: string;
  message?: string;
}
export interface OrchestrationStep {
  step: number;
  call: string;
  description: string;
}
export interface Section {
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
}
export interface Navigation {
  to: string;
  trigger: string;
  condition: string;
}
export interface Action {
  trigger: string;
  endpoint?: string;
  method?: string;
  requestBody?: string;
  onSuccess?: string;
  onError?: string;
  clientValidation?: string[];
}
export interface StateField {
  name: string;
  type: string;
  initialValue: string;
}
export interface ApiCall {
  hook: string;
  type: string;
  endpoint: string;
  method: string;
}
export interface PayloadField {
  name: string;
  type: string;
  description: string;
}
export interface Trigger {
  service: string;
  method: string;
  endpoint: string;
}

// Block types — re-exported from @specgen/core so the exporter doesn't depend on webapp
export type { Block, BlockType, TableData, ResponseData } from "@specgen/core";
