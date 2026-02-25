#!/usr/bin/env node
/**
 * DevLink CLI v2 - Local package development tool with namespaces
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
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
import { handleDocs, printDocsHelp } from "./commands/docs.js";
import { setRepoPath, getStorePath, DEFAULT_NAMESPACE } from "./constants.js";

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const VERSION = packageJson.version;

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean | string[]>;
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "",
    positional: [],
    flags: {},
  };
  
  let i = 0;
  
  // First, find the command (first non-flag argument)
  while (i < args.length) {
    const arg = args[i];
    if (!arg.startsWith("-")) {
      result.command = arg;
      i++;
      break;
    }
    // Parse flags that come before the command
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      
      if (key.includes("=")) {
        const [k, v] = key.split("=");
        result.flags[k] = v;
      } else if (!nextArg || nextArg.startsWith("-")) {
        result.flags[key] = true;
      } else {
        if (nextArg.includes(",")) {
          result.flags[key] = nextArg.split(",").map(s => s.trim());
        } else {
          result.flags[key] = nextArg;
        }
        i++;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];
      
      if (!nextArg || nextArg.startsWith("-")) {
        result.flags[key] = true;
      } else {
        if (nextArg.includes(",")) {
          result.flags[key] = nextArg.split(",").map(s => s.trim());
        } else {
          result.flags[key] = nextArg;
        }
        i++;
      }
    }
    i++;
  }
  
  // If no command found, default to help
  if (!result.command) {
    result.command = "help";
  }
  
  // Parse remaining arguments
  while (i < args.length) {
    const arg = args[i];
    
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      
      if (key.includes("=")) {
        const [k, v] = key.split("=");
        result.flags[k] = v;
      } else if (!nextArg || nextArg.startsWith("-")) {
        result.flags[key] = true;
      } else {
        if (nextArg.includes(",")) {
          result.flags[key] = nextArg.split(",").map(s => s.trim());
        } else {
          result.flags[key] = nextArg;
        }
        i++;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];
      
      if (!nextArg || nextArg.startsWith("-")) {
        result.flags[key] = true;
      } else {
        if (nextArg.includes(",")) {
          result.flags[key] = nextArg.split(",").map(s => s.trim());
        } else {
          result.flags[key] = nextArg;
        }
        i++;
      }
    } else {
      result.positional.push(arg);
    }
    
    i++;
  }
  
  return result;
}

function getString(flags: Record<string, any>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof flags[key] === "string") return flags[key];
  }
  return undefined;
}

function getStringArray(flags: Record<string, any>, ...keys: string[]): string[] | undefined {
  for (const key of keys) {
    if (Array.isArray(flags[key])) return flags[key];
    if (typeof flags[key] === "string") return [flags[key]];
  }
  return undefined;
}

function getBool(flags: Record<string, any>, ...keys: string[]): boolean {
  for (const key of keys) {
    if (flags[key] === true) return true;
  }
  return false;
}

// ============================================================================
// Documentation Hints
// ============================================================================

/**
 * Maps commands to their documentation paths
 */
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

/**
 * Print documentation hints for a command
 */
function printDocHints(command?: string): void {
  console.error("");
  console.error("📚 Documentation:");
  if (command && COMMAND_DOCS[command]) {
    console.error(`   devlink docs ${COMMAND_DOCS[command]}    Command reference`);
  }
  console.error("   devlink docs agents              Complete guide for AI agents");
  console.error("   devlink --help                   General help");
}

/**
 * Print error with documentation hints
 */
function printErrorWithHints(message: string, command?: string): void {
  console.error(`\n✗ Error: ${message}`);
  if (command) {
    console.error(`\nRun 'devlink ${command} --help' for usage information.`);
  }
  printDocHints(command);
}

// ============================================================================
// Help System
// ============================================================================

function printVersion(): void {
  console.log(`devlink v${VERSION}`);
}

function printMainHelp(): void {
  console.log(`
DevLink v${VERSION} - Local package development tool with namespaces

USAGE
  devlink <command> [options]

COMMANDS
  publish     Publish a package to the store
  push        Publish and update all consumer projects
  install     Install packages from the store into a project
  list        List packages in the store
  resolve     Resolve package locations in namespaces
  consumers   List projects that consume packages
  remove      Remove packages, versions, or namespaces
  verify      Verify store integrity
  prune       Remove orphaned packages from disk
  docs        Display embedded documentation

GLOBAL OPTIONS
  --repo <path>    Use custom repo path instead of ~/.devlink
  -h, --help       Show help (use with command for detailed help)
  -v, --version    Show version

ENVIRONMENT
  DEVLINK_REPO     Alternative to --repo flag

EXAMPLES
  devlink publish                    Publish to global namespace
  devlink publish -n feature         Publish to feature namespace
  devlink list                       List all packages
  devlink install --dev              Install in dev mode
  devlink resolve pkg@1.0.0          Find package location

DOCUMENTATION
  devlink docs                       Show documentation index
  devlink docs agents                Complete guide for AI agents
  devlink docs <topic>               Show specific topic

Run 'devlink <command> --help' for detailed help on a specific command.
`);
}

function printPublishHelp(): void {
  console.log(`
devlink publish - Publish a package to the store

USAGE
  devlink publish [options]

DESCRIPTION
  Publishes the package in the current directory to the DevLink store.
  The package must have a valid package.json with name and version fields.
  Files are copied based on the "files" field in package.json.

OPTIONS
  -n, --namespace <name>    Target namespace (default: ${DEFAULT_NAMESPACE})
  --repo <path>             Use custom repo path

EXAMPLES
  devlink publish                    Publish to global namespace
  devlink publish -n feature-v2      Publish to feature-v2 namespace
  devlink publish --repo /tmp/repo   Publish to custom repo

OUTPUT
  Shows package name, version, namespace, signature, and file count.
`);
}

function printPushHelp(): void {
  console.log(`
devlink push - Publish and update all consumer projects

USAGE
  devlink push [options]

DESCRIPTION
  Publishes the package and automatically updates all projects that
  consume it. This is useful during active development to propagate
  changes to dependent projects without manual reinstallation.

OPTIONS
  -n, --namespace <name>    Target namespace (default: ${DEFAULT_NAMESPACE})
  --repo <path>             Use custom repo path

EXAMPLES
  devlink push                       Push to global namespace
  devlink push -n feature            Push to feature namespace

HOW IT WORKS
  1. Publishes the package (same as 'devlink publish')
  2. Finds all projects in installations.json that use this package
  3. Re-links the package in each consumer project
  4. Updates signatures in installations.json and devlink.lock files
`);
}

function printInstallHelp(): void {
  console.log(`
devlink install - Install packages from the store

USAGE
  devlink install [options]

DESCRIPTION
  Installs packages defined in devlink.config.mjs from the store.
  Packages are resolved using namespace precedence and linked into
  the project's node_modules directory.

OPTIONS
  -n, --namespaces <list>   Override namespace precedence (comma-separated)
  -c, --config <path>       Path to config file
  --dev                     Force dev mode
  --prod                    Force prod mode
  --npm                     Also run 'npm install' after DevLink install
  --run-scripts             Allow npm scripts to run (default: scripts disabled)
  --repo <path>             Use custom repo path

CONFIG FILE
  Create devlink.config.mjs in your project:

  export default {
    packages: {
      "@scope/pkg": { dev: "1.0.0", prod: "1.0.0" },
    },
    dev: () => ({
      manager: "store",
      namespaces: ["feature", "global"],
      peerOptional: ["@scope/*"],
    }),
    prod: () => ({
      manager: "npm",
    }),
  };

EXAMPLES
  devlink install                         Use config file
  devlink install --dev                   Force dev mode
  devlink install --dev --npm             Install from store, then run npm install
  devlink install --dev --npm --run-scripts  Also run npm lifecycle scripts
  devlink install -n feature,global       Override namespaces

WORKFLOW
  For projects with internal dependencies not published to npm:
  
  1. devlink install --dev --npm     # Single command setup
  
  This replaces the need for preinstall/postinstall scripts in package.json.
`);
}

function printListHelp(): void {
  console.log(`
devlink list - List packages in the store

USAGE
  devlink list [options]

DESCRIPTION
  Lists all packages in the store, organized by namespace or by package.
  Supports filtering by namespace, package name, or scope.

OPTIONS
  -n, --namespaces <list>   Filter by namespaces (comma-separated)
  -p, --packages [list]     Group by package, optionally filter
  --flat                    Use flat output format (default: tree)
  --repo <path>             Use custom repo path

EXAMPLES
  devlink list                       List all by namespace (tree)
  devlink list --flat                List all by namespace (flat)
  devlink list -n global             List only global namespace
  devlink list -n global,feature     List multiple namespaces
  devlink list -p                    List grouped by package
  devlink list -p @scope             Filter by scope
  devlink list -p pkg1,pkg2          Filter specific packages

OUTPUT FORMATS
  Tree (default):
    global/
    ├── @scope/
    │   └── package/
    │       └── 1.0.0  (abc123)

  Flat:
    global  @scope/package@1.0.0  abc123
`);
}

function printResolveHelp(): void {
  console.log(`
devlink resolve - Resolve package locations

USAGE
  devlink resolve <pkg@version> [...] [options]

DESCRIPTION
  Shows where packages would be resolved from based on namespace
  precedence. Useful for debugging resolution issues.

ARGUMENTS
  <pkg@version>             Package spec(s) to resolve

OPTIONS
  -n, --namespaces <list>   Namespace precedence (comma-separated)
  --flat                    Use flat output format
  --path                    Output only store paths (machine-readable)
  --repo <path>             Use custom repo path

EXAMPLES
  devlink resolve @scope/pkg@1.0.0
  devlink resolve pkg1@1.0.0 pkg2@2.0.0
  devlink resolve @scope/pkg@1.0.0 -n feature,global

OUTPUT
  Shows for each package:
  - Which namespace it was found in
  - Full path to the package
  - Package signature
  - Namespaces that were searched
`);
}

function printConsumersHelp(): void {
  console.log(`
devlink consumers - List consumer projects

USAGE
  devlink consumers [options]

DESCRIPTION
  Lists all projects that have installed packages from the store.
  Can filter by package or namespace, and prune dead projects.

OPTIONS
  -p, --package <name>      Filter by package name
  -n, --namespace <name>    Filter by namespace
  --prune                   Remove projects that no longer exist
  --flat                    Use flat output format
  --repo <path>             Use custom repo path

EXAMPLES
  devlink consumers                  List all consumers
  devlink consumers -p @scope/pkg    Filter by package
  devlink consumers -n feature       Filter by namespace
  devlink consumers --prune          Remove dead projects

NOTE
  The --prune flag requires a lock and modifies installations.json.
`);
}

function printRemoveHelp(): void {
  console.log(`
devlink remove - Remove packages, versions, or namespaces

USAGE
  devlink remove <target> [options]

DESCRIPTION
  Removes packages from the store. Can remove:
  - A specific version: pkg@version
  - All versions of a package: pkg
  - An entire namespace: namespace-name

ARGUMENTS
  <target>                  What to remove (see examples)

OPTIONS
  -n, --namespace <name>    Target namespace (required for packages)
  --repo <path>             Use custom repo path

EXAMPLES
  devlink remove @scope/pkg@1.0.0 -n global    Remove specific version
  devlink remove @scope/pkg -n global          Remove all versions
  devlink remove feature-branch                Remove entire namespace

RESTRICTIONS
  - Cannot remove the 'global' namespace (reserved)
  - Removing a namespace removes all packages within it
`);
}

function printVerifyHelp(): void {
  console.log(`
devlink verify - Verify store integrity

USAGE
  devlink verify [options]

DESCRIPTION
  Checks the store for inconsistencies between the registry and
  the actual files on disk. Can automatically fix issues.

OPTIONS
  --fix                     Automatically fix issues found
  --repo <path>             Use custom repo path

CHECKS PERFORMED
  - Orphans in registry: entries without corresponding files
  - Orphans on disk: files without registry entries
  - Signature mismatches: content doesn't match recorded signature

EXAMPLES
  devlink verify                     Check for issues
  devlink verify --fix               Check and fix issues

NOTE
  The --fix flag requires a lock and modifies the store.
`);
}

function printPruneHelp(): void {
  console.log(`
devlink prune - Remove orphaned packages

USAGE
  devlink prune [options]

DESCRIPTION
  Removes packages from disk that are not in the registry.
  This cleans up orphaned files that may have been left behind.

OPTIONS
  -n, --namespace <name>    Only prune in specific namespace
  --dry-run                 Show what would be removed without removing
  --repo <path>             Use custom repo path

EXAMPLES
  devlink prune                      Remove all orphans
  devlink prune -n feature           Only prune feature namespace
  devlink prune --dry-run            Preview what would be removed

NOTE
  This command requires a lock and modifies the filesystem.
`);
}

function printCommandHelp(command: string): void {
  switch (command) {
    case "publish":
      printPublishHelp();
      break;
    case "push":
      printPushHelp();
      break;
    case "install":
      printInstallHelp();
      break;
    case "list":
      printListHelp();
      break;
    case "resolve":
      printResolveHelp();
      break;
    case "consumers":
      printConsumersHelp();
      break;
    case "remove":
      printRemoveHelp();
      break;
    case "verify":
      printVerifyHelp();
      break;
    case "prune":
      printPruneHelp();
      break;
    case "docs":
      printDocsHelp();
      break;
    default:
      printMainHelp();
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  
  // Handle --repo flag globally (before any command)
  const repoPath = getString(args.flags, "repo");
  if (repoPath) {
    setRepoPath(repoPath);
  }
  
  // Handle version flag
  if (getBool(args.flags, "v", "version")) {
    printVersion();
    return;
  }
  
  // Handle help flag
  if (getBool(args.flags, "h", "help")) {
    if (args.command && args.command !== "help") {
      printCommandHelp(args.command);
    } else {
      printMainHelp();
    }
    return;
  }
  
  // Handle help command
  if (args.command === "help") {
    if (args.positional.length > 0) {
      printCommandHelp(args.positional[0]);
    } else {
      printMainHelp();
    }
    return;
  }
  
  // Execute command
  switch (args.command) {
    case "publish":
      await handlePublish({
        namespace: getString(args.flags, "n", "namespace"),
      });
      break;
    
    case "push":
      await handlePush({
        namespace: getString(args.flags, "n", "namespace"),
      });
      break;
    
    case "install":
      await handleInstall({
        config: getString(args.flags, "c", "config"),
        dev: getBool(args.flags, "dev"),
        prod: getBool(args.flags, "prod"),
        namespaces: getStringArray(args.flags, "n", "namespaces"),
        npm: getBool(args.flags, "npm"),
        runScripts: getBool(args.flags, "run-scripts", "runScripts"),
      });
      break;
    
    case "list":
      await handleList({
        namespaces: getStringArray(args.flags, "n", "namespace", "namespaces"),
        packages: getStringArray(args.flags, "p", "package", "packages"),
        flat: getBool(args.flags, "flat"),
      });
      break;
    
    case "resolve":
      if (args.positional.length === 0) {
        printErrorWithHints("resolve requires at least one package spec (pkg@version)", "resolve");
        process.exit(1);
      }
      await handleResolve({
        specs: args.positional,
        namespaces: getStringArray(args.flags, "n", "namespace", "namespaces"),
        flat: getBool(args.flags, "flat"),
        path: getBool(args.flags, "path"),
      });
      break;
    
    case "consumers":
      await handleConsumers({
        package: getString(args.flags, "p", "package"),
        namespace: getString(args.flags, "n", "namespace"),
        flat: getBool(args.flags, "flat"),
        prune: getBool(args.flags, "prune"),
      });
      break;
    
    case "remove":
      if (args.positional.length === 0) {
        printErrorWithHints("remove requires a target (package@version, package, or namespace)", "remove");
        process.exit(1);
      }
      await handleRemove({
        target: args.positional[0],
        namespace: getString(args.flags, "n", "namespace"),
      });
      break;
    
    case "verify":
      await handleVerify({
        fix: getBool(args.flags, "fix"),
      });
      break;
    
    case "prune":
      await handlePrune({
        namespace: getString(args.flags, "n", "namespace"),
        dryRun: getBool(args.flags, "dry-run", "dryRun"),
      });
      break;
    
    case "docs":
      await handleDocs({
        document: args.positional[0],
      });
      break;
    
    default:
      printErrorWithHints(`Unknown command: ${args.command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\n✗ Error: ${error.message}`);
  printDocHints();
  process.exit(1);
});
