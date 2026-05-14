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
  handleList,
  handleResolve,
  handleConsumers,
  handleRemove,
  handleVerify,
  handlePrune,
  handleTree,
} from "./commands/index.js";
import { handleDocs } from "./commands/docs.js";
import { executePlan } from "./pipeline/plan.js";
import { executeStage } from "./pipeline/stage.js";
import { executeInject } from "./pipeline/inject.js";
import { executeNpmInstall } from "./pipeline/npm-install.js";
import { executeLink } from "./pipeline/link.js";
import { executeHydrate } from "./pipeline/hydrate.js";
import { executeApply } from "./pipeline/apply.js";
import { executeInstall, executeInstallRecursive } from "./pipeline/install.js";
import { createOutputRouter } from "./pipeline/output-router.js";
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
  plan: "installation/plan",
  stage: "installation/stage",
  inject: "installation/inject",
  "npm-install": "installation/npm-install",
  link: "installation/link",
  hydrate: "installation/hydrate",
  apply: "installation/apply",
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
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    await handlePublish({ namespace: opts.namespace, json: !!opts.json });
  });

// ── push ──────────────────────────────────────────────────────────────────────

program
  .command("push")
  .description("Publish and update all consumer projects")
  .option(`-n, --namespace <name>`, `Target namespace (default: ${DEFAULT_NAMESPACE})`)
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    await handlePush({ namespace: opts.namespace, json: !!opts.json });
  });

// ── plan ───────────────────────────────────────────────────────────────────

program
  .command("plan")
  .description("Resolve packages and produce an installation plan")
  .option("-c, --config <path>", "Path to config file")
  .option("--config-name <filename>", "Config file name to search for (e.g. webforgeai.config.mjs)")
  .option("--config-key <key>", "Key within the config export to extract DevLink config from")
  .option("-m, --mode <name>", "Set install mode (matches config mode name)")
  .option("-n, --namespaces <list>", "Override namespace precedence (comma-separated)", commaSeparated)
  .option("-p, --only <list>", "Only plan specific packages (comma-separated)", commaSeparated)
  .option("--packages <json>", "JSON object of packages to merge/override into config (key-level override)")
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    const router = createOutputRouter(!!opts.json);
    try {
      const plan = await executePlan({
        config: opts.config,
        configName: opts.configName,
        configKey: opts.configKey,
        mode: opts.mode,
        namespaces: opts.namespaces,
        packages: opts.only,
        packagesOverride: opts.packages ? JSON.parse(opts.packages) : undefined,
        json: !!opts.json,
      });

      router.json(plan);

      if (!opts.json) {
        const storeCount = plan.packages.store.length;
        const registryCount = plan.packages.registry.length;
        const linkCount = plan.packages.link.length;
        const removeCount = plan.packages.remove.length;
        router.human(`── Plan ──`);
        router.human(`  Mode: ${plan.mode || "(universal)"} | Manager: ${plan.manager} | Namespaces: ${plan.namespaces.join(", ")}`);
        router.human(`  ${storeCount} packages from store, ${registryCount} from registry, ${linkCount} link, ${removeCount} remove`);
      }
    } catch (error: any) {
      router.log(`✗ Plan failed: ${error.message}`);
      printDocHints("plan");
      process.exit(1);
    }
  });

// ── stage ──────────────────────────────────────────────────────────────────

program
  .command("stage")
  .description("Copy resolved packages to .devlink/ staging directory")
  .option("--plan <path>", "Path to plan JSON file (reads from stdin if omitted)")
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    const router = createOutputRouter(!!opts.json);
    try {
      const result = await executeStage({
        plan: opts.plan,
        json: !!opts.json,
      });

      router.json(result);

      if (!opts.json) {
        const stagedCount = result.staged.length;
        const relinkCount = result.relinked.length;
        router.human(`── Stage ──`);
        router.human(`  Staged ${stagedCount} packages to .devlink/`);
        router.human(`  Re-linked ${relinkCount} internal dependencies`);
      }
    } catch (error: any) {
      router.log(`✗ Stage failed: ${error.message}`);
      printDocHints("stage");
      process.exit(1);
    }
  });

// ── inject ─────────────────────────────────────────────────────────────────

program
  .command("inject")
  .description("Rewrite package.json with dependency references from staged packages")
  .option("--stage <path>", "Path to stage JSON file (reads from stdin if omitted)")
  .option("--plan <path>", "Path to plan JSON file")
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    const router = createOutputRouter(!!opts.json);
    try {
      const result = await executeInject({
        stage: opts.stage,
        plan: opts.plan,
        json: !!opts.json,
      });

      router.json(result);

      if (!opts.json) {
        const injectedCount = result.injected.length + result.registry.length;
        const removedCount = result.removed.length;
        router.human(`── Inject ──`);
        router.human(`  Modified package.json: ${injectedCount} injected, ${removedCount} removed`);
      }
    } catch (error: any) {
      router.log(`✗ Inject failed: ${error.message}`);
      printDocHints("inject");
      process.exit(1);
    }
  });

// ── npm-install ────────────────────────────────────────────────────────────────

program
  .command("npm-install")
  .description("Run npm install in the project directory")
  .option("--npm-ignore-scripts", "Pass --ignore-scripts to npm install")
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    const router = createOutputRouter(!!opts.json);
    try {
      const result = await executeNpmInstall({
        ignoreScripts: opts.npmIgnoreScripts,
        json: !!opts.json,
      });

      router.json(result);

      if (!opts.json) {
        router.human(`── npm install ──`);
        router.human(`  Exit code: ${result.exitCode}`);
      }
    } catch (error: any) {
      router.log(`✗ npm-install failed: ${error.message}`);
      printDocHints("npm-install");
      process.exit(1);
    }
  });

// ── link ──────────────────────────────────────────────────────────────────────

program
  .command("link")
  .description("Create npm links for packages with local path references")
  .option("--plan <path>", "Path to plan JSON file (reads from stdin if omitted)")
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    const router = createOutputRouter(!!opts.json);
    try {
      const result = await executeLink({
        plan: opts.plan,
        json: !!opts.json,
      });

      router.json(result);

      if (!opts.json) {
        router.human(`── Link ──`);
        for (const entry of result.linked) {
          router.human(`  ${entry.name} → ${entry.path} ✓`);
        }
        for (const entry of result.failed) {
          router.human(`  ${entry.name} → ${entry.path} ✗ (exit ${entry.exitCode})`);
        }
        router.human(`  ${result.linked.length} linked, ${result.failed.length} failed`);
      }
    } catch (error: any) {
      router.log(`✗ Link failed: ${error.message}`);
      printDocHints("link");
      process.exit(1);
    }
  });

// ── hydrate ───────────────────────────────────────────────────────────────────

program
  .command("hydrate")
  .description("Run npm install and link packages (composite: npm-install → link)")
  .option("--plan <path>", "Path to plan JSON file (for link entries)")
  .option("--npm-ignore-scripts", "Pass --ignore-scripts to npm install")
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    const router = createOutputRouter(!!opts.json);
    try {
      const result = await executeHydrate({
        plan: opts.plan,
        ignoreScripts: opts.npmIgnoreScripts,
        json: !!opts.json,
      });

      router.json(result);

      if (!opts.json) {
        const npmExit = result.trace?.["npm-install"]
          ? (result.trace["npm-install"] as any).exitCode
          : "?";
        const linkResult = result.trace?.link as any;
        const linkedCount = linkResult?.linked?.length ?? 0;
        const failedCount = linkResult?.failed?.length ?? 0;
        router.human(`── Hydrate ──`);
        router.human(`  npm install exit code: ${npmExit}`);
        router.human(`  ${linkedCount} linked, ${failedCount} failed`);
      }
    } catch (error: any) {
      router.log(`✗ Hydrate failed: ${error.message}`);
      printDocHints("hydrate");
      process.exit(1);
    }
  });

// ── apply ─────────────────────────────────────────────────────────────────────

program
  .command("apply")
  .description("Inject dependencies and hydrate project (composite: inject → hydrate)")
  .option("--stage <path>", "Path to stage JSON file (reads from stdin if omitted)")
  .option("--plan <path>", "Path to plan JSON file")
  .option("--npm-ignore-scripts", "Pass --ignore-scripts to npm install")
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    const router = createOutputRouter(!!opts.json);
    try {
      const result = await executeApply({
        stage: opts.stage,
        plan: opts.plan,
        ignoreScripts: opts.npmIgnoreScripts,
        json: !!opts.json,
      });

      router.json(result);

      if (!opts.json) {
        const injectResult = result.trace?.inject as any;
        const hydrateResult = result.trace?.hydrate as any;
        const injectedCount = (injectResult?.injected?.length ?? 0) + (injectResult?.registry?.length ?? 0);
        const removedCount = injectResult?.removed?.length ?? 0;
        const npmExit = hydrateResult?.trace?.["npm-install"]
          ? (hydrateResult.trace["npm-install"] as any).exitCode
          : "?";
        const linkedCount = hydrateResult?.trace?.link?.linked?.length ?? 0;
        const failedCount = hydrateResult?.trace?.link?.failed?.length ?? 0;
        router.human(`── Apply ──`);
        router.human(`  Inject: ${injectedCount} injected, ${removedCount} removed`);
        router.human(`  npm install exit code: ${npmExit}`);
        router.human(`  ${linkedCount} linked, ${failedCount} failed`);
      }
    } catch (error: any) {
      router.log(`✗ Apply failed: ${error.message}`);
      printDocHints("apply");
      process.exit(1);
    }
  });

// ── install ───────────────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install packages from the store into a project")
  .argument("[packages...]", "Specific packages to install (must be defined in config)")
  .option("-c, --config <path>", "Path to config file")
  .option("--config-name <filename>", "Config file name to search for at every level (e.g. webforgeai.config.mjs)")
  .option("--config-key <key>", "Key within the config export to extract DevLink config from (e.g. devlink)")
  .option("-n, --namespaces <list>", "Override namespace precedence (comma-separated)", commaSeparated)
  .option("-m, --mode <name>", "Set install mode (matches config mode name, e.g. dev, remote)")
  .option("--packages <json>", "JSON object of packages to merge/override into config (key-level override)")
  .option("--npm-ignore-scripts", "Propagate --ignore-scripts to npm install")
  .option("--json", "Output structured JSON to stdout")
  .option("-r, --recursive", "Install recursively across all monorepo levels")
  .action(async (only: string[], opts) => {
    if (opts.recursive && opts.json) {
      // Recursive + JSON mode: use the new pipeline for structured per-level output
      const { scanTree } = await import("./core/tree.js");
      const router = createOutputRouter(true);

      try {
        const tree = await scanTree(process.cwd());
        const result = await executeInstallRecursive(tree, {
          config: opts.config,
          configName: opts.configName,
          configKey: opts.configKey,
          mode: opts.mode,
          namespaces: opts.namespaces,
          packages: only.length > 0 ? only : undefined,
          packagesOverride: opts.packages ? JSON.parse(opts.packages) : undefined,
          ignoreScripts: opts.npmIgnoreScripts,
          json: true,
        });

        router.json(result);

        if (!result.success) {
          process.exit(1);
        }
      } catch (error: any) {
        router.log(`✗ Recursive install failed: ${error.message}`);
        printDocHints("install");
        process.exit(1);
      }
    } else if (opts.recursive) {
      // Recursive mode without JSON: use the pipeline with human output
      const { scanTree } = await import("./core/tree.js");
      const router = createOutputRouter(false);

      router.human(`📂 Scanning monorepo...`);
      const tree = await scanTree(process.cwd());
      router.human(`  Found ${tree.installLevels.length} install levels, ${tree.isolatedPackages.length} isolated package(s)`);

      try {
        const result = await executeInstallRecursive(tree, {
          config: opts.config,
          configName: opts.configName,
          configKey: opts.configKey,
          mode: opts.mode,
          namespaces: opts.namespaces,
          packages: only.length > 0 ? only : undefined,
          packagesOverride: opts.packages ? JSON.parse(opts.packages) : undefined,
          ignoreScripts: opts.npmIgnoreScripts,
          json: false,
        });

        for (const level of result.levels) {
          const status = level.success ? "✓" : "✗";
          router.human(`\n── ${level.relativePath} ${status} ──`);
          if (level.error) {
            router.human(`  Error: ${level.error}`);
          }
        }

        for (const iso of result.isolatedPackages) {
          const status = iso.success ? "✓" : "✗";
          router.human(`\n── Isolated: ${iso.relativePath} ${status} ──`);
          if (iso.error) {
            router.human(`  Error: ${iso.error}`);
          }
        }

        if (result.success) {
          router.human(`\n✅ Recursive install complete`);
        } else {
          router.human(`\n✗ Recursive install completed with errors`);
          process.exit(1);
        }
      } catch (error: any) {
        router.log(`✗ Recursive install failed: ${error.message}`);
        printDocHints("install");
        process.exit(1);
      }
    } else if (opts.json) {
      // JSON mode: use the new pipeline for structured output
      const router = createOutputRouter(true);
      try {
        const result = await executeInstall({
          config: opts.config,
          configName: opts.configName,
          configKey: opts.configKey,
          mode: opts.mode,
          namespaces: opts.namespaces,
          packages: only.length > 0 ? only : undefined,
          packagesOverride: opts.packages ? JSON.parse(opts.packages) : undefined,
          ignoreScripts: opts.npmIgnoreScripts,
          json: true,
        });

        router.json(result);

        if (!result.success) {
          process.exit(1);
        }
      } catch (error: any) {
        router.log(`✗ Install failed: ${error.message}`);
        printDocHints("install");
        process.exit(1);
      }
    } else {
      // Human-friendly mode: execute steps sequentially with output between each
      const router = createOutputRouter(false);
      try {
        // ── Plan ──
        router.human(`── Plan ──`);
        const planResult = await executePlan({
          config: opts.config,
          configName: opts.configName,
          configKey: opts.configKey,
          mode: opts.mode,
          namespaces: opts.namespaces,
          packages: only.length > 0 ? only : undefined,
          packagesOverride: opts.packages ? JSON.parse(opts.packages) : undefined,
          json: false,
        });
        const storeCount = planResult.packages.store.length;
        const registryCount = planResult.packages.registry.length;
        const linkCount = planResult.packages.link.length;
        const removeCount = planResult.packages.remove.length;
        const skippedCount = planResult.packages.skipped.length;
        router.human(`  Mode: ${planResult.mode || "(universal)"} | Manager: ${planResult.manager} | Namespaces: ${planResult.namespaces.join(", ")}`);
        router.human(`  ${storeCount} from store, ${registryCount} from registry, ${linkCount} link, ${removeCount} remove`);
        if (skippedCount > 0) {
          router.human(`  ⚠️  ${skippedCount} skipped:`);
          for (const s of planResult.packages.skipped) {
            router.human(`    - ${s.name}@${s.version}: ${s.reason}`);
          }
        }

        // ── Stage ──
        router.human(`\n── Stage ──`);
        const stageResult = await executeStage({
          planData: planResult,
          projectPath: planResult.projectPath,
          json: false,
        });
        router.human(`  Staged ${stageResult.staged.length} packages to .devlink/`);
        if (stageResult.relinked.length > 0) {
          router.human(`  Re-linked ${stageResult.relinked.length} internal dependencies`);
        }

        // ── Inject ──
        router.human(`\n── Inject ──`);
        const injectResult = await executeInject({
          stageData: stageResult,
          planData: planResult,
          projectPath: planResult.projectPath,
          json: false,
        });
        const injectedCount = injectResult.injected.length + injectResult.registry.length;
        const removedInjCount = injectResult.removed.length;
        const syntheticCount = injectResult.synthetic.length;
        router.human(`  Modified package.json: ${injectedCount} injected, ${removedInjCount} removed${syntheticCount > 0 ? `, ${syntheticCount} synthetic` : ""}`);

        // ── npm install ──
        router.human(`\n── npm install ──`);
        const npmResult = await executeNpmInstall({
          projectPath: planResult.projectPath,
          ignoreScripts: opts.npmIgnoreScripts,
          json: false,
        });
        if (npmResult.exitCode !== 0) {
          router.human(`  ✗ npm install failed (exit code ${npmResult.exitCode})`);
          process.exit(1);
        }
        router.human(`  Exit code: ${npmResult.exitCode}`);

        // ── Link ──
        if (planResult.packages.link.length > 0) {
          router.human(`\n── Link ──`);
          const linkResult = await executeLink({
            planData: planResult,
            projectPath: planResult.projectPath,
            json: false,
          });
          for (const entry of linkResult.linked) {
            router.human(`  ${entry.name} → ${entry.path} ✓`);
          }
          for (const entry of linkResult.failed) {
            router.human(`  ${entry.name} → ${entry.path} ✗ (exit ${entry.exitCode})`);
          }
        }

        router.human(`\n✅ Install complete`);
      } catch (error: any) {
        router.human(`\n✗ Install failed: ${error.message}`);
        printDocHints("install");
        process.exit(1);
      }
    }
  });

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List packages in the store")
  .option("-n, --namespaces <list>", "Filter by namespaces (comma-separated)", commaSeparated)
  .option("-p, --packages [list]", "Group by package, optionally filter")
  .option("--flat", "Use flat output format (default: tree)")
  .option("--json", "Output structured JSON to stdout")
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
      json: !!opts.json,
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
  .option("--json", "Output structured JSON to stdout")
  .action(async (specs: string[], opts) => {
    await handleResolve({
      specs,
      namespaces: opts.namespaces,
      flat: opts.flat,
      path: opts.path,
      json: !!opts.json,
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
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    await handleConsumers({
      package: opts.package,
      namespace: opts.namespace,
      flat: opts.flat,
      prune: opts.prune,
      json: !!opts.json,
    });
  });

// ── remove ────────────────────────────────────────────────────────────────────

program
  .command("remove")
  .description("Remove packages, versions, or namespaces")
  .argument("<target>", "What to remove (pkg@version, pkg, or namespace)")
  .option("-n, --namespace <name>", "Target namespace (required for packages)")
  .option("--json", "Output structured JSON to stdout")
  .action(async (target: string, opts) => {
    await handleRemove({
      target,
      namespace: opts.namespace,
      json: !!opts.json,
    });
  });

// ── verify ────────────────────────────────────────────────────────────────────

program
  .command("verify")
  .description("Verify store integrity")
  .option("--fix", "Automatically fix issues found")
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    await handleVerify({ fix: opts.fix, json: !!opts.json });
  });

// ── prune ─────────────────────────────────────────────────────────────────────

program
  .command("prune")
  .description("Remove orphaned packages from disk")
  .option("-n, --namespace <name>", "Only prune in specific namespace")
  .option("--dry-run", "Show what would be removed without removing")
  .option("--json", "Output structured JSON to stdout")
  .action(async (opts) => {
    await handlePrune({
      namespace: opts.namespace,
      dryRun: opts.dryRun,
      json: !!opts.json,
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
