// Canonical types extracted from legacy parsers.
// Re-export the existing shapes verbatim so consumers don't break.
import type { AiClient } from "../ai/AiClient.js";
import type { ParserFileSystem } from "./FileSystem.js";

export interface EventSpec {
  name: string;
  summary: string;
  context: string;
  payload: { name: string; type: string; description: string }[];
  payloadExample: string;
  triggers: { service: string; method: string; endpoint: string }[];
  handler: string;
  handlerDescription: string;
  sourceFiles: string[];
}

export interface BackendSpec {
  endpoint: string;
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
  responses: { status: number; type?: string; description: string }[];
  validationRules: { field: string; rule: string; message?: string }[];
  orchestration: { step: number; call: string; description: string }[];
  dependencies: string[];
  sourceFiles: string[];
}

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
  apiCalls: {
    hook: string;
    type: "REST" | "GraphQL";
    endpoint: string;
    method: string;
  }[];
}

export interface DetectInput {
  rootDir: string; // absolute path to the project root being detected
  fs: ParserFileSystem; // pluggable filesystem (LocalFs for local, GitHubFs for D.5)
}

export interface ParseInput {
  rootDir: string; // absolute path to the project root being parsed
  fs: ParserFileSystem; // pluggable filesystem (LocalFs for local, GitHubFs for D.5)
  subDirs?: string[]; // optional list returned by detect()
  config?: Record<string, unknown>; // parser-specific options
  /**
   * Optional AI client. Only LLM-driven parsers (e.g. @specgen/parser-llm)
   * read this; rule-based parsers ignore it. The caller is responsible for
   * providing a fully configured `AiClient` (via `buildAiRouter` or similar)
   * when invoking an LLM parser; rule parsers receive `undefined` here.
   */
  aiClient?: AiClient;
  /**
   * Optional model id to use with `aiClient.complete()`. When omitted, an
   * LLM parser falls back to its own default or the first model advertised
   * by the client.
   */
  aiModel?: string;
  /**
   * Optional set of `sourceFiles` already covered by other (rule) parsers.
   * The LLM parser uses this in "fallback" mode to skip files that have
   * already been extracted, so the AI only fills gaps.
   */
  ruleParserOutput?: ParseResult;
}

export interface ParseResult {
  endpoints?: BackendSpec[];
  pages?: FrontendSpec[];
  events?: EventSpec[];
  warnings: string[];
}

export interface DetectResult {
  confidence: number; // 0..1
  subDirs: string[]; // discovered relevant subdirectories
}
