/**
 * Install Command — Full composite orchestrator for plan → stage → apply pipeline.
 *
 * Executes the complete installation pipeline in sequence: plan → stage → apply.
 * Uses fail-fast semantics: if any step fails, subsequent steps are skipped and
 * the command reports `success: false`. Collects outputs into a recursive trace
 * with keys "plan", "stage", and "apply".
 *
 * Plan "fails" if it throws (config not found, invalid mode, etc.).
 * Stage "fails" if it throws (filesystem errors, invalid plan input).
 * Apply "fails" if its success field is false (inject or hydrate failure).
 *
 * Supports all config-related options and propagates them to sub-commands.
 * Uses dependency injection for testability.
 */

import path from "path";
import { executeComposite, type CompositeStep } from "./composite.js";
import { executePlan } from "./plan.js";
import { executeStage } from "./stage.js";
import { executeApply } from "./apply.js";
import { executeNpmInstall } from "./npm-install.js";
import type {
  InstallOptions,
  InstallOutput,
  PlanOutput,
  StageOutput,
  ApplyOutput,
  RecursiveInstallOptions,
  RecursiveInstallOutput,
  RecursiveLevelResult,
  RecursiveIsolatedResult,
} from "./types.js";
import type { MonorepoTree } from "../types.js";

// ============================================================================
// Dependency Injection Interface (for testability)
// ============================================================================

/**
 * Injectable dependencies for the install command.
 *
 * Allows unit tests to provide mock implementations of sub-commands
 * without executing real filesystem operations, npm processes, or config loading.
 */
export interface InstallDeps {
  executePlan: (options: {
    config?: string;
    configName?: string;
    configKey?: string;
    mode?: string;
    namespaces?: string[];
    packages?: string[];
    packagesOverride?: Record<string, any>;
    json?: boolean;
  }) => Promise<PlanOutput>;
  executeStage: (options: { plan?: string; planData?: PlanOutput; projectPath?: string; json?: boolean }) => Promise<StageOutput>;
  executeApply: (options: {
    stage?: string;
    plan?: string;
    stageData?: StageOutput;
    planData?: PlanOutput;
    projectPath?: string;
    ignoreScripts?: boolean;
    json?: boolean;
  }) => Promise<ApplyOutput>;
}

// ============================================================================
// Default Dependencies
// ============================================================================

function createDefaultDeps(): InstallDeps {
  return {
    executePlan,
    executeStage,
    executeApply,
  };
}

// ============================================================================
// Install Execution
// ============================================================================

/**
 * Executes the install composite command — plan → stage → apply.
 *
 * Public entry point for production use. Delegates to `executeInstallWithDeps`
 * with real sub-command implementations.
 *
 * @param options - Install command options (config, mode, namespaces, packages, ignoreScripts, json)
 * @returns Structured InstallOutput with success flag and recursive trace
 */
export async function executeInstall(options: InstallOptions = {}): Promise<InstallOutput> {
  return executeInstallWithDeps(options, createDefaultDeps());
}

/**
 * Testable version of executeInstall that accepts injected dependencies.
 *
 * Orchestrates plan → stage → apply using the composite execution pattern.
 * Plan and stage "fail" if they throw exceptions. Apply "fails" if its
 * success field is false. The trace is recursive — apply's output contains
 * its own trace with inject and hydrate sub-command outputs.
 *
 * @param options - Install command options
 * @param deps - Injectable dependencies (sub-command executors)
 * @returns Structured InstallOutput with success flag and recursive trace
 */
export async function executeInstallWithDeps(
  options: InstallOptions = {},
  deps: InstallDeps
): Promise<InstallOutput> {
  // State shared between steps — plan and stage outputs are needed by later steps
  let planOutput: PlanOutput | undefined;
  let stageOutput: StageOutput | undefined;

  const projectPath = process.cwd();

  const steps: CompositeStep[] = [
    {
      name: "plan",
      execute: async () => {
        try {
          planOutput = await deps.executePlan({
            config: options.config,
            configName: options.configName,
            configKey: options.configKey,
            mode: options.mode,
            namespaces: options.namespaces,
            packages: options.packages,
            packagesOverride: options.packagesOverride,
            json: options.json,
          });
          return { success: true, output: planOutput };
        } catch (error) {
          return {
            success: false,
            output: { error: error instanceof Error ? error.message : String(error) },
          };
        }
      },
    },
    {
      name: "stage",
      execute: async () => {
        try {
          stageOutput = await deps.executeStage({
            projectPath: planOutput!.projectPath,
            planData: planOutput,
            json: options.json,
          });
          return { success: true, output: stageOutput };
        } catch (error) {
          return {
            success: false,
            output: { error: error instanceof Error ? error.message : String(error) },
          };
        }
      },
    },
    {
      name: "apply",
      execute: async () => {
        const output = await deps.executeApply({
          projectPath: planOutput!.projectPath,
          planData: planOutput,
          stageData: stageOutput,
          ignoreScripts: options.ignoreScripts,
          json: options.json,
        });
        // Apply reports its own success field
        return { success: output.success, output };
      },
    },
  ];

  const result = await executeComposite<InstallOutput>(steps, { projectPath });
  return result.output;
}


// ============================================================================
// Recursive Install Execution
// ============================================================================

/**
 * Injectable dependencies for the recursive install command.
 */
export interface RecursiveInstallDeps {
  executeInstall: (options: InstallOptions) => Promise<InstallOutput>;
  executeNpmInstall: (options: { projectPath?: string; ignoreScripts?: boolean; json?: boolean }) => Promise<{ projectPath: string; exitCode: number; args: string[] }>;
  /** Change working directory. Defaults to process.chdir. */
  chdir: (dir: string) => void;
  /** Get current working directory. Defaults to process.cwd. */
  cwd: () => string;
}

/** Default deps using real implementations. */
function createDefaultRecursiveDeps(): RecursiveInstallDeps {
  return {
    executeInstall,
    executeNpmInstall,
    chdir: (dir) => process.chdir(dir),
    cwd: () => process.cwd(),
  };
}

/**
 * Executes the install pipeline recursively across all monorepo levels.
 *
 * Uses the tree scanner output to discover install levels and isolated packages.
 * Executes the full pipeline (plan → stage → apply) at each install level in order:
 * root → sub-monorepos. For isolated packages, runs only npm install (no DevLink config).
 *
 * Continues on failure — all levels are attempted regardless of individual failures.
 * Produces structured output with per-level results.
 *
 * @param tree - MonorepoTree from the tree scanner
 * @param options - Recursive install options (config, mode, etc.)
 * @returns Structured RecursiveInstallOutput with per-level results
 */
export async function executeInstallRecursive(
  tree: MonorepoTree,
  options: RecursiveInstallOptions = {},
): Promise<RecursiveInstallOutput> {
  return executeInstallRecursiveWithDeps(tree, options, createDefaultRecursiveDeps());
}

/**
 * Testable version of executeInstallRecursive that accepts injected dependencies.
 *
 * @param tree - MonorepoTree from the tree scanner
 * @param options - Recursive install options
 * @param deps - Injectable dependencies
 * @returns Structured RecursiveInstallOutput with per-level results
 */
export async function executeInstallRecursiveWithDeps(
  tree: MonorepoTree,
  options: RecursiveInstallOptions = {},
  deps: RecursiveInstallDeps,
): Promise<RecursiveInstallOutput> {
  const levels: RecursiveLevelResult[] = [];
  const isolatedResults: RecursiveIsolatedResult[] = [];
  let allSuccess = true;

  // Phase 1: Execute pipeline at each install level (root → sub-monorepos)
  for (const level of tree.installLevels) {
    const originalCwd = deps.cwd();
    try {
      deps.chdir(level.path);
      const result = await deps.executeInstall({
        config: options.config,
        configName: options.configName,
        configKey: options.configKey,
        mode: options.mode,
        namespaces: options.namespaces,
        packages: options.packages,
        packagesOverride: options.packagesOverride,
        ignoreScripts: options.ignoreScripts,
        json: options.json,
      });

      levels.push({
        path: level.path,
        relativePath: level.relativePath,
        success: result.success,
        trace: result.trace,
      });

      if (!result.success) {
        allSuccess = false;
      }
    } catch (error: unknown) {
      allSuccess = false;
      levels.push({
        path: level.path,
        relativePath: level.relativePath,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      deps.chdir(originalCwd);
    }
  }

  // Phase 2: Execute npm install at each isolated package (no DevLink config)
  for (const isoPath of tree.isolatedPackages) {
    const relativePath = path.relative(tree.root, isoPath);
    try {
      const npmResult = await deps.executeNpmInstall({
        projectPath: isoPath,
        ignoreScripts: options.ignoreScripts,
        json: options.json,
      });

      const success = npmResult.exitCode === 0;
      if (!success) {
        allSuccess = false;
      }

      isolatedResults.push({
        path: isoPath,
        relativePath,
        success,
        npmExitCode: npmResult.exitCode,
      });
    } catch (error: unknown) {
      allSuccess = false;
      isolatedResults.push({
        path: isoPath,
        relativePath,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    projectPath: tree.root,
    success: allSuccess,
    recursive: true,
    levels,
    isolatedPackages: isolatedResults,
  };
}
