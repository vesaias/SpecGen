import type { ParserFileSystem } from "@specgen/core";

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

/**
 * Recursively collect all .cs file paths (relative to fs.rootDir) under `relDir`,
 * skipping `bin` and `obj` directories.
 */
async function findCsFiles(relDir: string, fsys: ParserFileSystem): Promise<string[]> {
  const results: string[] = [];
  const exists = await fsys.exists(relDir);
  if (!exists) return results;
  for await (const entry of fsys.walk(relDir, { ignore: ["bin", "obj"] })) {
    if (!entry.isDirectory && entry.path.endsWith(".cs")) {
      results.push(entry.path);
    }
  }
  return results;
}

function extractXmlSummary(text: string, pos: number): string {
  // Look backwards from pos for /// <summary> block
  const before = text.slice(0, pos);
  const lines = before.split("\n");
  const summaryLines: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("///")) {
      summaryLines.unshift(line.replace(/^\/\/\/\s?/, ""));
    } else if (line.startsWith("[") || line === "") {
    } else {
      break;
    }
  }
  const joined = summaryLines.join(" ");
  const match = joined.match(/<summary>(.*?)<\/summary>/s);
  return match ? match[1]!.trim() : "";
}

function parseDtoFromContent(
  content: string,
  className: string,
  prefix: string,
  allFiles: Map<string, string>,
  visited: Set<string>,
): { name: string; type: string; required: boolean; description: string; validation?: string }[] {
  if (visited.has(className)) return [];
  visited.add(className);

  const fields: {
    name: string;
    type: string;
    required: boolean;
    description: string;
    validation?: string;
  }[] = [];

  // Find class body using brace counting
  function extractClassBody(src: string, cls: string): string | null {
    const idx = src.indexOf(`class ${cls}`);
    if (idx === -1) return null;
    const braceStart = src.indexOf("{", idx);
    if (braceStart === -1) return null;
    let depth = 1;
    let i = braceStart + 1;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      if (src[i] === "}") depth--;
      i++;
    }
    return src.slice(braceStart + 1, i - 1);
  }

  let classBody = extractClassBody(content, className);
  if (!classBody) {
    for (const [, fc] of allFiles) {
      classBody = extractClassBody(fc, className);
      if (classBody) break;
    }
  }
  if (!classBody) return fields;

  const propRegex =
    /(?:((?:\s*\/\/\/.*\n)*)\s*((?:\[[\w\(\),\s"=.]+\]\s*)*))public\s+([\w<>?,\s]+)\s+(\w+)\s*\{/g;
  let match;
  while ((match = propRegex.exec(classBody)) !== null) {
    const xmlBlock = match[1] ?? "";
    const attrBlock = match[2] ?? "";
    const propType = match[3]!.trim();
    const propName = match[4]!;

    const summaryMatch = xmlBlock.match(/<summary>(.*?)<\/summary>/s);
    const description = summaryMatch ? summaryMatch[1]!.trim() : "";
    const required = /\[Required\]/.test(attrBlock);

    const validations: string[] = [];
    const rangeMatch = attrBlock.match(/\[Range\(([^)]+)\)\]/);
    if (rangeMatch) validations.push(`Range(${rangeMatch[1]})`);
    const strLenMatch = attrBlock.match(/\[StringLength\(([^)]+)\)\]/);
    if (strLenMatch) validations.push(`StringLength(${strLenMatch[1]})`);
    const maxLenMatch = attrBlock.match(/\[MaxLength\(([^)]+)\)\]/);
    if (maxLenMatch) validations.push(`MaxLength(${maxLenMatch[1]})`);

    const fieldName = prefix ? `${prefix}.${propName}` : propName;

    // Check if type is a collection of a custom class: List<Foo>, ICollection<Foo>
    const listMatch = propType.match(/(?:List|ICollection|IEnumerable)<(\w+)>/);
    // Check if type is a custom class (not primitive)
    const primitives = [
      "string",
      "int",
      "long",
      "decimal",
      "double",
      "float",
      "bool",
      "DateTime",
      "Guid",
      "object",
    ];
    const isCustomType = !primitives.includes(propType.replace("?", "")) && !listMatch;

    if (listMatch) {
      const innerType = listMatch[1]!;
      if (!primitives.includes(innerType)) {
        // Add the list field itself
        fields.push({
          name: fieldName,
          type: `${innerType}[]`,
          required,
          description,
          validation: validations.length > 0 ? validations.join(", ") : undefined,
        });
        // Recurse into the item type
        const nested = parseDtoFromContent(content, innerType, `${fieldName}[]`, allFiles, visited);
        fields.push(...nested);
      } else {
        fields.push({
          name: fieldName,
          type: propType,
          required,
          description,
          validation: validations.length > 0 ? validations.join(", ") : undefined,
        });
      }
    } else if (isCustomType && !propType.includes("?")) {
      // Recurse into nested custom type
      fields.push({
        name: fieldName,
        type: propType,
        required,
        description,
        validation: validations.length > 0 ? validations.join(", ") : undefined,
      });
      const nested = parseDtoFromContent(
        content,
        propType.replace("?", ""),
        fieldName,
        allFiles,
        visited,
      );
      fields.push(...nested);
    } else {
      fields.push({
        name: fieldName,
        type: propType,
        required,
        description,
        validation: validations.length > 0 ? validations.join(", ") : undefined,
      });
    }
  }

  return fields;
}

function parseDto(
  content: string,
  className: string,
  allFiles?: Map<string, string>,
): { name: string; type: string; required: boolean; description: string; validation?: string }[] {
  return parseDtoFromContent(content, className, "", allFiles ?? new Map(), new Set());
}

// Resolve a class's route by checking the file and its base class files
function resolveClassRoute(
  content: string,
  className: string,
  allFiles: Map<string, string>,
): string {
  // Check current file for [Route]
  const routeMatch = content.match(/\[Route\("([^"]+)"\)\]/);
  if (routeMatch) {
    let route = routeMatch[1]!;
    // Replace [controller] placeholder with actual controller name (strip "Controller" suffix)
    const shortName = className.replace(/Controller$/, "");
    route = route.replace(/\[controller\]/gi, shortName);
    return route;
  }

  // Check base class
  const baseMatch = content.match(/public\s+class\s+\w+\s*:\s*(\w+)/);
  if (baseMatch) {
    const baseName = baseMatch[1]!;
    for (const [, fc] of allFiles) {
      if (fc.includes(`class ${baseName}`)) {
        return resolveClassRoute(fc, className, allFiles);
      }
    }
  }
  return "";
}

/**
 * Parse a single controller file given its relative path and pre-loaded content map.
 * `relPath` is the key as stored in allFiles (relative to fs.rootDir).
 */
function parseControllerFile(
  relPath: string,
  content: string,
  allFiles: Map<string, string>,
): BackendSpec[] {
  const specs: BackendSpec[] = [];

  // Check if it's a controller — match ControllerBase, [ApiController], or any class ending in Controller
  const classNameMatch = content.match(/public\s+class\s+(\w+)\s*:\s*(\w+)/);
  if (!classNameMatch) return specs;
  const controllerName = classNameMatch[1]!;
  const baseName = classNameMatch[2]!;

  // Must be a controller: name ends with Controller, or inherits from something with Controller, or has [ApiController]
  const isController =
    controllerName.endsWith("Controller") &&
    (baseName.includes("Controller") ||
      baseName === "ControllerBase" ||
      content.includes("[ApiController]") ||
      content.includes("[HttpGet") ||
      content.includes("[HttpPost"));

  // Skip base/abstract controllers that don't have action methods themselves
  if (!isController) return specs;
  if (
    content.includes("abstract class") &&
    !content.includes("[HttpGet") &&
    !content.includes("[HttpPost")
  )
    return specs;

  // Resolve route including from base class
  const classRoute = resolveClassRoute(content, controllerName, allFiles);

  // Extract class-level XML summary
  const classSummaryPos = content.indexOf(`class ${controllerName}`);
  const controllerSummary = extractXmlSummary(content, classSummaryPos);

  // Find action methods — handles sync and async, Task<T> return types
  const methodRegex =
    /(\[Http(Get|Post|Put|Delete|Patch)\(?("[^"]*")?\)?\][\s\S]*?)public\s+(?:async\s+)?(?:Task<)?[\w<>]+>?\s+(\w+)\s*\(([^)]*)\)/g;
  let methodMatch;

  while ((methodMatch = methodRegex.exec(content)) !== null) {
    const httpMethod = methodMatch[2]!.toUpperCase();
    const methodRoute = methodMatch[3]?.replace(/"/g, "") ?? "";
    const methodName = methodMatch[4]!;
    const params = methodMatch[5]!;

    // Build full route
    let fullRoute = `/${[classRoute, methodRoute].filter(Boolean).join("/").replace(/\/+/g, "/")}`;
    // Clean up route: strip :type constraints, rename generic {id} to contextual name
    fullRoute = fullRoute.replace(/\{(\w+):(\w+)\}/g, "{$1}"); // {id:int} → {id}
    // Rename generic {id} to contextual name using controller
    let resourceName = controllerName.replace(/Controller$/, "");
    if (resourceName.endsWith("ies")) resourceName = `${resourceName.slice(0, -3)}y`;
    else if (resourceName.endsWith("s") && !resourceName.endsWith("ss"))
      resourceName = resourceName.slice(0, -1);
    fullRoute = fullRoute.replace(/\{id\}/g, `{${resourceName.toLowerCase()}Id}`);

    // Extract method-level XML summary
    const methodSummary = extractXmlSummary(content, methodMatch.index);

    // Extract [ProducesResponseType] — search the full attribute block above the method
    const responses: { status: number; type?: string; description: string }[] = [];
    const seen = new Set<number>();

    // Get all text from just before the [Http*] attribute to the method signature
    const attrStart = content.lastIndexOf("\n", methodMatch.index);
    let searchStart = attrStart;
    // Walk backwards to find all consecutive attribute/comment lines
    for (let i = attrStart - 1; i >= 0; i--) {
      const ch = content[i];
      if (ch === "\n") {
        const line = content.slice(i + 1, searchStart).trim();
        if (line.startsWith("[") || line.startsWith("///") || line === "") {
          searchStart = i;
        } else {
          break;
        }
      }
    }
    const attrRegion = content.slice(searchStart, methodMatch.index + methodMatch[0].length);

    const producesRegex =
      /\[ProducesResponseType\((?:typeof\((\w+(?:<[^>]+>)?)\),\s*)?(?:StatusCodes\.)?Status(\d+)\w*\)\]/g;
    let prodMatch;
    while ((prodMatch = producesRegex.exec(attrRegion)) !== null) {
      const status = Number.parseInt(prodMatch[2]!);
      if (seen.has(status)) continue;
      seen.add(status);

      const statusDescriptions: Record<number, string> = {
        200: "Success",
        201: "Created",
        204: "No Content",
        400: "Bad Request — validation errors",
        401: "Unauthorized",
        404: "Not Found",
        409: "Conflict",
        500: "Internal Server Error",
      };

      responses.push({
        status,
        type: prodMatch[1] ?? undefined,
        description: statusDescriptions[status] ?? `HTTP ${status}`,
      });
    }

    // Parse parameters
    const parameters: BackendSpec["parameters"] = [];
    // Match {paramName} or {paramName:type}
    const pathParams = fullRoute.match(/\{[^}]+\}/g) ?? [];
    for (const p of pathParams) {
      const inner = p.replace(/[{}]/g, ""); // e.g. "id:int" or "portfolioId:int"
      const cleanName = inner.split(":")[0]!; // "id" or "portfolioId"
      const constraintType = inner.includes(":") ? inner.split(":")[1] : null; // "int"

      // Determine type from constraint or method signature
      const typeRegex = new RegExp(`(?:int|string|Guid|long)\\s+${cleanName}(?:\\s|,|\\))`);
      const typeMatch = params.match(typeRegex);
      const resolvedType = typeMatch ? typeMatch[0]!.split(/\s+/)[0]! : (constraintType ?? "int");

      // Generate contextual name: if generic "id", derive from controller/route context
      let contextualName = cleanName;
      if (cleanName === "id") {
        // Derive from controller: ClientsController → clientId, PortfoliosController → portfolioId
        let resource = controllerName.replace(/Controller$/, "");
        // Singularize: Securities→Security, Clients→Client, etc.
        if (resource.endsWith("ies")) resource = `${resource.slice(0, -3)}y`;
        else if (resource.endsWith("s") && !resource.endsWith("ss"))
          resource = resource.slice(0, -1);
        contextualName = `${resource.toLowerCase()}Id`;
      }

      parameters.push({
        name: contextualName,
        location: "path",
        type: resolvedType,
        required: true,
        description: "",
      });
    }

    // Query params
    const queryRegex = /\[FromQuery\]\s*([\w?]+)\s+(\w+)(?:\s*=\s*[^,)]+)?/g;
    let qMatch;
    while ((qMatch = queryRegex.exec(params)) !== null) {
      parameters.push({
        name: qMatch[2]!,
        location: "query",
        type: qMatch[1]!.replace("?", ""),
        required: !qMatch[1]!.includes("?") && !params.includes(`${qMatch[2]} =`),
        description: "",
      });
    }
    // Also catch params with default values (implicit query)
    const implicitQueryRegex = /(?<!\[From\w+\]\s*)(string|int|bool)\??\s+(\w+)\s*=\s*/g;
    let iqMatch;
    while ((iqMatch = implicitQueryRegex.exec(params)) !== null) {
      if (!parameters.find((p) => p.name === iqMatch![2])) {
        parameters.push({
          name: iqMatch[2]!,
          location: "query",
          type: iqMatch[1]!,
          required: false,
          description: "",
        });
      }
    }

    // Body param
    let requestBody: BackendSpec["requestBody"] | undefined;
    const bodyMatch = params.match(/\[FromBody\]\s*(\w+)\s+(\w+)/);
    if (bodyMatch) {
      const dtoName = bodyMatch[1]!;
      // Find DTO in all files
      let dtoFields: NonNullable<BackendSpec["requestBody"]>["fields"] = [];
      for (const [, fc] of allFiles) {
        if (fc.includes(`class ${dtoName}`)) {
          dtoFields = parseDto(fc, dtoName, allFiles);
          break;
        }
      }
      requestBody = { dtoName, fields: dtoFields };
    }

    // Extract method body for orchestration
    const methodBodyStart = content.indexOf("{", methodMatch.index + methodMatch[0].length);
    if (methodBodyStart > -1) {
      let braceCount = 1;
      let i = methodBodyStart + 1;
      while (i < content.length && braceCount > 0) {
        if (content[i] === "{") braceCount++;
        if (content[i] === "}") braceCount--;
        i++;
      }
      const methodBody = content.slice(methodBodyStart + 1, i - 1);

      // Extract service/data calls
      const orchestration: BackendSpec["orchestration"] = [];
      const callRegex = /(?:await\s+)?(?:_\w+|MockDataStore)\.(\w+)\s*\(/g;
      let callMatch;
      let step = 1;
      while ((callMatch = callRegex.exec(methodBody)) !== null) {
        orchestration.push({
          step: step++,
          call: callMatch[0]!.replace(/\s*\($/, ""),
          description: "[TODO]",
        });
      }

      // Detect implicit response codes from method body
      if (methodBody.includes("NotFound(") && !seen.has(404)) {
        responses.push({ status: 404, description: "Not Found" });
      }
      if (methodBody.includes("BadRequest(") && !seen.has(400)) {
        responses.push({ status: 400, description: "Bad Request — validation errors" });
      }
      if (methodBody.includes("NoContent(") && !seen.has(204)) {
        responses.push({ status: 204, description: "No Content" });
      }
      if (methodBody.includes("CreatedAtAction(") && !seen.has(201)) {
        responses.push({ status: 201, description: "Created" });
      }
      if ((methodBody.includes("Ok(") || methodBody.includes("return Ok(")) && !seen.has(200)) {
        responses.push({ status: 200, description: "Success" });
      }
      // Every endpoint can potentially return 500
      if (!seen.has(500)) {
        responses.push({ status: 500, description: "Internal Server Error" });
      }
      // Sort by status code
      responses.sort((a, b) => a.status - b.status);

      // Suppress unused variable warning — methodName is used for documentation purposes
      void methodName;

      specs.push({
        endpoint: `${httpMethod} ${fullRoute}`,
        method: httpMethod,
        route: fullRoute,
        controller: controllerName,
        summary: methodSummary || controllerSummary,
        context: "[TODO: Human fills]",
        parameters,
        requestBody,
        responses,
        validationRules: [],
        orchestration,
        dependencies: [],
        sourceFiles: [relPath],
      });
    }
  }

  // Extract DI dependencies from constructor
  const ctorMatch = content.match(/public\s+\w+\(([\s\S]*?)\)/);
  if (ctorMatch) {
    const ctorParams = ctorMatch[1]!;
    const diRegex = /(I\w+)\s+_?\w+/g;
    let diMatch;
    while ((diMatch = diRegex.exec(ctorParams)) !== null) {
      for (const spec of specs) {
        spec.dependencies.push(diMatch[1]!);
      }
    }
  }

  return specs;
}

export async function parseBackend(
  _backendDir: string,
  fsys: ParserFileSystem,
): Promise<BackendSpec[]> {
  const csFiles = await findCsFiles(".", fsys);
  const allFiles = new Map<string, string>();
  for (const f of csFiles) {
    allFiles.set(f, await fsys.readFile(f));
  }

  const specs: BackendSpec[] = [];
  for (const [relPath, content] of allFiles) {
    specs.push(...parseControllerFile(relPath, content, allFiles));
  }

  return specs;
}

export async function parseEvents(
  _backendDir: string,
  fsys: ParserFileSystem,
): Promise<EventSpec[]> {
  const csFiles = await findCsFiles(".", fsys);
  const allFiles = new Map<string, string>();
  for (const f of csFiles) {
    allFiles.set(f, await fsys.readFile(f));
  }

  const events: EventSpec[] = [];

  // Find event record types
  for (const [filePath, content] of allFiles) {
    const eventRegex =
      /\/\/\/\s*<summary>(.*?)<\/summary>\s*\n\s*public\s+record\s+(\w+Event)\(([^)]*)\)/gs;
    let m;
    while ((m = eventRegex.exec(content)) !== null) {
      const summary = m[1]!.trim();
      const name = m[2]!;
      const paramsStr = m[3]!;

      // Parse payload fields
      const payload: EventSpec["payload"] = [];
      for (const param of paramsStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        const parts = param.split(/\s+/);
        if (parts.length >= 2) {
          const type = parts.slice(0, -1).join(" ");
          const fieldName = parts[parts.length - 1]!;
          payload.push({ name: fieldName, type, description: "" });
        }
      }

      // Generate payload example
      const exampleObj: Record<string, unknown> = {};
      for (const p of payload) {
        const n = p.name.toLowerCase();
        const t = p.type.toLowerCase();
        if (n.includes("portfolioid")) exampleObj[p.name] = 1;
        else if (n.includes("securityid")) exampleObj[p.name] = 3;
        else if (n.includes("transactionid")) exampleObj[p.name] = 42;
        else if (n.includes("allocation")) exampleObj[p.name] = 0.25;
        else if (n.includes("quantity")) exampleObj[p.name] = 500.0;
        else if (n.includes("amount")) exampleObj[p.name] = 5000.0;
        else if (t.includes("list<int>")) exampleObj[p.name] = [1, 2, 3];
        else if (t.includes("dictionary")) exampleObj[p.name] = { "1": 0.3, "2": 0.25, "3": 0.45 };
        else if (t === "string")
          exampleObj[p.name] = n.includes("rule")
            ? "Quantity exceeds maximum"
            : n.includes("detail")
              ? "Item out of stock"
              : "";
        else if (t.includes("transactiontype")) exampleObj[p.name] = "Buy";
        else if (t === "int") exampleObj[p.name] = 1;
        else if (t === "decimal") exampleObj[p.name] = 0;
        else exampleObj[p.name] = null;
      }

      // Find handler
      let handlerFile = "";
      let handlerName = "";
      const handlerFileName = name.replace("Event", "Handler");
      for (const [fp, fc] of allFiles) {
        if (
          fc.includes(`class ${handlerFileName}`) ||
          fc.includes(`class ${name.replace("Event", "")}Handler`)
        ) {
          handlerFile = fp;
          handlerName = fp.includes(handlerFileName)
            ? handlerFileName
            : name.replace("Event", "Handler");
          break;
        }
      }

      // Find which services publish this event
      const triggers: EventSpec["triggers"] = [];
      for (const [, fc] of allFiles) {
        if (fc.includes(`new ${name}(`)) {
          const serviceMatch = fc.match(/class\s+(\w+Service)/);
          if (serviceMatch) {
            // Find which method publishes it
            const methodRegexLocal = new RegExp(
              `public\\s+async\\s+Task[^{]*\\{[\\s\\S]*?new ${name}\\(`,
              "g",
            );
            const mm = methodRegexLocal.exec(fc);
            const methodNameMatch = mm
              ? fc.slice(0, mm.index).match(/public\s+async\s+Task<[^>]+>\s+(\w+)\s*\(/g)
              : null;
            let triggerMethod = "unknown";
            if (methodNameMatch) {
              const last = methodNameMatch[methodNameMatch.length - 1]!;
              const nameMatch = last.match(/(\w+)\s*\(/);
              if (nameMatch) triggerMethod = nameMatch[1]!;
            }
            triggers.push({
              service: serviceMatch[1]!,
              method: triggerMethod,
              endpoint: "",
            });
          }
        }
      }

      events.push({
        name,
        summary,
        context: "[TODO: Human fills]",
        payload,
        payloadExample: JSON.stringify(exampleObj, null, 2),
        triggers,
        handler: handlerName,
        handlerDescription: "[TODO]",
        sourceFiles: [filePath, handlerFile].filter(Boolean),
      });
    }
  }

  return events;
}
