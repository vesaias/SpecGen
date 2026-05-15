#!/usr/bin/env node
import { initCommand } from "./commands/init.js";
import { parseCommand } from "./commands/parse.js";
import { printServeUsage, serveCommand } from "./commands/serve.js";

const args = process.argv.slice(2);
const subcmd = args[0];

async function main(): Promise<number> {
  switch (subcmd) {
    case "init": {
      const r = await initCommand({});
      if (r.status === "created") {
        process.stdout.write(`[specgen] created ${r.configPath}\n`);
        process.stdout.write("Next: run `specgen parse` to generate the initial spec.\n");
      } else {
        process.stdout.write(`[specgen] config already exists at ${r.configPath}\n`);
      }
      return 0;
    }

    case "parse": {
      const opts = parseFlags(args.slice(1));
      if (opts.help) {
        printUsage();
        return 0;
      }
      const r = await parseCommand(opts);
      return r.status === "success" ? 0 : 1;
    }

    case "serve": {
      const serveOpts = parseServeFlags(args.slice(1));
      if (serveOpts.help) {
        printServeUsage();
        return 0;
      }
      await serveCommand(serveOpts);
      // serveCommand blocks until SIGINT — returning 0 here is unreachable in normal use
      return 0;
    }

    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      return 0;

    default:
      process.stderr.write(`Unknown command: ${subcmd}\n`);
      printUsage();
      return 2;
  }
}

interface ServeFlagResult {
  db?: string;
  dev?: boolean;
  host?: string;
  port?: number;
  help?: boolean;
}

function parseServeFlags(rest: string[]): ServeFlagResult {
  const out: ServeFlagResult = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--db") {
      out.db = rest[i + 1];
      i++;
    } else if (a === "--host") {
      out.host = rest[i + 1];
      i++;
    } else if (a === "--port") {
      out.port = Number(rest[i + 1]);
      i++;
    } else if (a === "--dev") out.dev = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

interface ParseFlagResult {
  root?: string;
  dataDir?: string;
  profile?: string;
  generator?: string;
  quiet?: boolean;
  dryRun?: boolean;
  provider?: string;
  help?: boolean;
}

function parseFlags(rest: string[]): ParseFlagResult {
  const out: ParseFlagResult = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--root") {
      out.root = rest[i + 1];
      i++;
    } else if (a === "--data-dir") {
      out.dataDir = rest[i + 1];
      i++;
    } else if (a === "--profile") {
      out.profile = rest[i + 1];
      i++;
    } else if (a === "--generator") {
      out.generator = rest[i + 1];
      i++;
    } else if (a === "--provider") {
      out.provider = rest[i + 1];
      i++;
    } else if (a === "--quiet") out.quiet = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printUsage(): void {
  process.stdout.write(`specgen — profile-based documentation generator

Usage:
  specgen init                Scaffold .specgen/config.yaml (advanced; consider the dashboard instead)
  specgen parse [flags]       Parse the project and write spec content
  specgen serve [flags]       Start the SpecGen API server

parse flags:
  --root <path>              Project root (default: cwd)
  --data-dir <path>          Where to write spec (default: from config or <root>/.specgen/data)
  --profile <id>             Override profile (default: from config or pm-spec)
  --generator <id>           Override generator (default: full-tree-spec)
  --provider <id>            AI provider: local|claude_api|claude_code|openai|openai_compat|ollama
                             (default: auto-detected from env)
  --quiet                    Suppress progress output
  --dry-run                  Run pipeline without writing

serve flags:
  --db <path>                Path to sqlite database (default: ~/.specgen/specgen.db)
  --dev                      Dev mode — skip serving webapp static files
  --host <host>              Bind host (default: 127.0.0.1)
  --port <port>              Bind port (default: 6101)
`);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[specgen] fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
