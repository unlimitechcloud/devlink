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
  handleTree,
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
  tree: "inspection/tree",
  docs: "agents",
};

function printDocHints(command?: string): void {
  console.error("");
  console.error("📚 Documentation:");
  if (command && COMMAND_DOCS[command]) {
    console.error(`   dev-link docs ${COMMAND_DOCS[command]}.md    Command reference`);
  }
  console.error("   dev-link docs agents.md              Complete guide for AI agents");
  console.error("   dev-link --help                      General help");
}

// ── Helper to split comma-separated values ────────────────────────────────────

function commaSeparated(value: string): string[] {
  return value.split(",").map((s) => s.trim());
}

// ── Program ───────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("dev-link")
  .description("Local package development tool with namespaces")
  .version(`dev-link v${VERSION}`, "-v, --version")
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
  .option("--config-name <filename>", "Config file name to search for at every level (e.g. webforgeai.config.mjs)")
  .option("--config-key <key>", "Key within the config export to extract DevLink config from (e.g. devlink)")
  .option("-n, --namespaces <list>", "Override namespace precedence (comma-separated)", commaSeparated)
  .option("-m, --mode <name>", "Set install mode (matches config mode name, e.g. dev, remote)")
  .option("--npm", "Run npm install before DevLink installs packages")
  .option("--run-scripts", "Allow npm scripts to run (default: scripts disabled)")
  .option("-r, --recursive", "Install recursively across all monorepo levels")
  .action(async (opts) => {
    if (opts.recursive) {
      // Recursive mode: use multi-level installer
      const { scanTree } = await import("./core/tree.js");
      const { installMultiLevel } = await import("./core/multilevel.js");

      const mode = opts.mode;

      console.log(`📂 Scanning monorepo...`);
      const tree = await scanTree(process.cwd());
      console.log(`  Found ${tree.installLevels.length} install levels, ${tree.isolatedPackages.length} isolated package(s)`);

      try {
        const result = await installMultiLevel({
          tree,
          mode,
          runNpm: opts.npm ?? false,
          runScripts: opts.runScripts,
          config: opts.config,
          configName: opts.configName,
          configKey: opts.configKey,
        });

        if (!result.success) {
          process.exit(1);
        }
      } catch (error: any) {
        console.error(`\n✗ Recursive install failed: ${error.message}`);
        process.exit(1);
      }
    } else {
      await handleInstall({
        config: opts.config,
        mode: opts.mode,
        namespaces: opts.namespaces,
        npm: opts.npm,
        runScripts: opts.runScripts,
        configName: opts.configName,
        configKey: opts.configKey,
      });
    }
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

// ── tree ───────────────────────────────────────────────────────────────────

program
  .command("tree")
  .description("Display monorepo structure")
  .option("--json", "Output as JSON for tool consumption")
  .option("--depth <n>", "Maximum scan depth", parseInt)
  .option("--config-name <filename>", "Config file name to detect (e.g. webforgeai.config.mjs)")
  .option("--config-key <key>", "Key within the config export to extract DevLink config from (e.g. devlink)")
  .action(async (opts) => {
    await handleTree({ json: opts.json, depth: opts.depth });
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
   dev-link docs                    Browse documentation
   dev-link docs agents.md          Agent guide (root)

🤖 AI Agents:
   Start with "dev-link docs agents.md" for the root guide.
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
