import type { DetectInput, DetectResult, ParseInput, ParseResult } from "./types.js";

export interface ParserPlugin {
  id: string;
  name: string;
  detect(input: DetectInput): Promise<DetectResult>;
  parse(input: ParseInput): Promise<ParseResult>;
}
