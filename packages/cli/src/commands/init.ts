import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { LocalFs, ParserRegistry } from "@specgen/core";
import { dotnetParser } from "@specgen/parser-dotnet";
import { reactParser } from "@specgen/parser-react";

export interface InitOptions {
  cwd?: string;
}

export interface InitResult {
  status: "created" | "already-exists";
  configPath: string;
}

export async function initCommand(opts: InitOptions = {}): Promise<InitResult> {
  process.stderr.write(
    "[specgen] note: most users no longer need `specgen init` — create a project from\n" +
      "          the dashboard at http://127.0.0.1:6100/projects/new. Continuing anyway.\n",
  );

  const root = opts.cwd ?? process.cwd();
  const configDir = path.join(root, ".specgen");
  const configPath = path.join(configDir, "config.yaml");

  if (existsSync(configPath)) {
    return { status: "already-exists", configPath };
  }

  // Detect parsers
  const registry = new ParserRegistry();
  registry.register(dotnetParser);
  registry.register(reactParser);
  const detected = await registry.detectAll(root, new LocalFs(root));
  const parserIds = detected.map((d) => d.plugin.id);

  await fs.mkdir(configDir, { recursive: true });
  const yaml = renderConfigYaml(parserIds);
  await fs.writeFile(configPath, yaml, "utf8");

  return { status: "created", configPath };
}

function renderConfigYaml(parserIds: string[]): string {
  const parsersBlock = parserIds.length
    ? parserIds.map((id) => `  - ${id}`).join("\n")
    : "  # no parsers auto-detected; add manually";
  return `# SpecGen project config

# The profile to use for AI-driven prompts.
profile: pm-spec

# Parsers enabled for this project. Auto-detected on init:
parsers:
${parsersBlock}

# Override profile prompts here (optional). Files in .specgen/profiles/<id>/prompts/
# replace the packaged ones for this project only.

# AI defaults (overrideable; falls back to profile defaults).
ai:
  # model: claude-haiku-4-5
  # temperature: 0.2
  # concurrency: 3

# Where the generated spec content goes. Relative to project root or absolute.
dataDir: ./.specgen/data
`;
}
