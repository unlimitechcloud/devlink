#!/usr/bin/env node
/**
 * DevLink CLI - Local package development tool with namespaces
 *
 * Powered by Commander.js for standard CLI parsing.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Command } from "commander";
import {
  handlePublish,
  handlePush,
  handleInstall,
  handleList,
  handleResolve,
  handleConsumers,
  handleRemove,
  handleVerify,
  handlePrune,
} from "./commands/index.js";
import { handleDocs } from "./commands/docs.js";
import { setRepoPath, DEFAULT_NAMESPACE } from "./constants.js";

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const VERSION = packageJson.version;

// ── Documentation hints ───────────────────────────────────────────────────────

const COMMAND_DOCS: Record<string, string> = {
  publish: "publishing/publish",
  push: "publishing/push",
  install: "installation/install",
  list: "inspection/list",
  resolve: "inspection/resolve",
  consumers: "inspection/consumers",
  remove: "maintenance/remove",
  verify: "maintenance/verify",
  prune: "maintenance/prune",
  docs: "agents",
};

function printDocHints(command?: string): void {
  console.error("");
  console.error("📚 Documentation:");
  if (command && COMMAND_DOCS[command]) {
    console.error(`   devlink docs ${COMMAND_DOCS[command]}.md    Command reference`);
  }
  console.error("   devlink docs agents.md              Complete guide for AI agents");
  console.error("   devlink --help                      General help");
}

// ── Helper to split comma-separated values ────────────────────────────────────

function commaSeparated(value: string): string[] {
  return value.split(",").map((s) => s.trim());
}

// ── Program ───────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("devlink")
  .description("Local package development tool with namespaces")
  .version(`devlink v${VERSION}`, "-v, --version")
  .option("--repo <path>", "Use custom repo path instead of ~/.devlink")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.repo) {
      setRepoPath(opts.repo);
    }
  });

// ── publish ───────────────────────────────────────────────────────────────────

program
  .command("publish")
  .description("Publish a package to the store")
  .option(`-n, --namespace <name>`, `Target namespace (default: ${DEFAULT_NAMESPACE})`)
  .action(async (opts) => {
    await handlePublish({ namespace: opts.namespace });
  });

// ── push ──────────────────────────────────────────────────────────────────────

program
  .command("push")
  .description("Publish and update all consumer projects")
  .option(`-n, --namespace <name>`, `Target namespace (default: ${DEFAULT_NAMESPACE})`)
  .action(async (opts) => {
    await handlePush({ namespace: opts.namespace });
  });

// ── install ───────────────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install packages from the store into a project")
  .option("-c, --config <path>", "Path to config file")
  .option("-n, --namespaces <list>", "Override namespace precedence (comma-separated)", commaSeparated)
  .option("--dev", "Force dev mode")
  .option("--prod", "Force prod mode")
  .option("--npm", "Run npm install before DevLink installs packages")
  .option("--run-scripts", "Allow npm scripts to run (default: scripts disabled)")
  .action(async (opts) => {
    await handleInstall({
      config: opts.config,
      dev: opts.dev,
      prod: opts.prod,
      namespaces: opts.namespaces,
      npm: opts.npm,
      runScripts: opts.runScripts,
    });
  });

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List packages in the store")
  .option("-n, --namespaces <list>", "Filter by namespaces (comma-separated)", commaSeparated)
  .option("-p, --packages [list]", "Group by package, optionally filter")
  .option("--flat", "Use flat output format (default: tree)")
  .action(async (opts) => {
    // -p can be boolean (true) or a string; normalize to string[] | undefined
    let packages: string[] | undefined;
    if (opts.packages === true) {
      packages = [];
    } else if (typeof opts.packages === "string") {
      packages = opts.packages.split(",").map((s: string) => s.trim());
    }
    await handleList({
      namespaces: opts.namespaces,
      packages,
      flat: opts.flat,
    });
  });

// ── resolve ───────────────────────────────────────────────────────────────────

program
  .command("resolve")
  .description("Resolve package locations in namespaces")
  .argument("<specs...>", "Package spec(s) to resolve (pkg@version)")
  .option("-n, --namespaces <list>", "Namespace precedence (comma-separated)", commaSeparated)
  .option("--flat", "Use flat output format")
  .option("--path", "Output only store paths (machine-readable)")
  .action(async (specs: string[], opts) => {
    await handleResolve({
      specs,
      namespaces: opts.namespaces,
      flat: opts.flat,
      path: opts.path,
    });
  });

// ── consumers ─────────────────────────────────────────────────────────────────

program
  .command("consumers")
  .description("List projects that consume packages")
  .option("-p, --package <name>", "Filter by package name")
  .option("-n, --namespace <name>", "Filter by namespace")
  .option("--flat", "Use flat output format")
  .option("--prune", "Remove projects that no longer exist")
  .action(async (opts) => {
    await handleConsumers({
      package: opts.package,
      namespace: opts.namespace,
      flat: opts.flat,
      prune: opts.prune,
    });
  });

// ── remove ────────────────────────────────────────────────────────────────────

program
  .command("remove")
  .description("Remove packages, versions, or namespaces")
  .argument("<target>", "What to remove (pkg@version, pkg, or namespace)")
  .option("-n, --namespace <name>", "Target namespace (required for packages)")
  .action(async (target: string, opts) => {
    await handleRemove({
      target,
      namespace: opts.namespace,
    });
  });

// ── verify ────────────────────────────────────────────────────────────────────

program
  .command("verify")
  .description("Verify store integrity")
  .option("--fix", "Automatically fix issues found")
  .action(async (opts) => {
    await handleVerify({ fix: opts.fix });
  });

// ── prune ─────────────────────────────────────────────────────────────────────

program
  .command("prune")
  .description("Remove orphaned packages from disk")
  .option("-n, --namespace <name>", "Only prune in specific namespace")
  .option("--dry-run", "Show what would be removed without removing")
  .action(async (opts) => {
    await handlePrune({
      namespace: opts.namespace,
      dryRun: opts.dryRun,
    });
  });

// ── docs ──────────────────────────────────────────────────────────────────────

program
  .command("docs")
  .description("Display embedded documentation")
  .argument("[document]", "Document or directory path (case insensitive, .md optional)")
  .action(async (document?: string) => {
    await handleDocs({ document });
  });

// ── Discovery notice in help ──────────────────────────────────────────────────

const DOCS_NOTICE = `
📚 Documentation:
   devlink docs                    Browse documentation
   devlink docs agents.md          Agent guide (root)

🤖 AI Agents:
   Start with "devlink docs agents.md" for the root guide.
   Each directory has an agents.md with context for that section.
   Navigate deeper: agents.md → store/agents.md, publishing/agents.md, etc.`;

program.addHelpText("after", DOCS_NOTICE);

program.configureOutput({
  outputError: (str: string, write: (s: string) => void) => {
    write(str);
    write(DOCS_NOTICE + "\n");
  },
});

// ── Parse & run ───────────────────────────────────────────────────────────────

program.parseAsync().catch((error) => {
  console.error(`\n✗ Error: ${error.message}`);
  printDocHints();
  process.exit(1);
});
