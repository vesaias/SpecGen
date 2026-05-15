import type {
  DetectInput,
  DetectResult,
  ParseInput,
  ParseResult,
  ParserPlugin,
} from "@specgen/core";
import { detectPython } from "./detect.js";
import { parseBackend } from "./parseBackend.js";

export const pythonParser: ParserPlugin = {
  id: "python",
  name: "Python (FastAPI + Flask) Backend Parser",

  async detect(input: DetectInput): Promise<DetectResult> {
    return detectPython(input);
  },

  async parse(input: ParseInput): Promise<ParseResult> {
    return parseBackend(input);
  },
};

export default pythonParser;
export { detectPython } from "./detect.js";
export { parseBackend } from "./parseBackend.js";
export { extractFastApiRoutes } from "./fastapi.js";
export { extractFlaskRoutes } from "./flask.js";
export { extractPydanticClasses } from "./pydantic.js";
export { extractSqlAlchemyModels } from "./sqlalchemy.js";
