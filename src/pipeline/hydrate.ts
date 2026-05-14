/**
 * Hydrate Command — Composite orchestrator for npm-install → link sequence.
 *
 * Executes npm-install first; if it fails (exitCode !== 0), skips the link step
 * and reports `success: false`. Otherwise executes link and collects both outputs
 * into a trace with keys "npm-install" and "link".
 *
 * Uses the generic `executeComposite` utility for fail-fast semantics and trace
 * collection. Accepts dependency injection for testability — sub-command executors
 * can be replaced with mocks in unit tests.
 */

import { executeComposite, type CompositeStep } from "./composite.js";
import { executeNpmInstall } from "./npm-install.js";
import { executeLink } from "./link.js";
import type {
  HydrateOptions,
  HydrateOutput,
  NpmInstallOutput,
  LinkOutput,
} from "./types.js";

// ============================================================================
// Dependency Injection Interface (for testability)
// ============================================================================

/**
 * Injectable dependencies for the hydrate command.
 *
 * Allows unit tests to provide mock implementations of sub-commands
 * without executing real npm processes.
 */
export interface HydrateDeps {
  executeNpmInstall: (options: { projectPath?: string; ignoreScripts?: boolean; json?: boolean }) => Promise<NpmInstallOutput>;
  executeLink: (options: { plan?: string; planData?: any; projectPath?: string; json?: boolean }) => Promise<LinkOutput>;
}

// ============================================================================
// Default Dependencies
// ============================================================================

function createDefaultDeps(): HydrateDeps {
  return {
    executeNpmInstall,
    executeLink,
  };
}

// ============================================================================
// Hydrate Execution
// ============================================================================

/**
 * Executes the hydrate composite command — npm-install → link.
 *
 * Public entry point for production use. Delegates to `executeHydrateWithDeps`
 * with real sub-command implementations.
 *
 * @param options - Hydrate command options (plan, projectPath, ignoreScripts, json)
 * @returns Structured HydrateOutput with success flag and trace
 */
export async function executeHydrate(options: HydrateOptions = {}): Promise<HydrateOutput> {
  return executeHydrateWithDeps(options, createDefaultDeps());
}

/**
 * Testable version of executeHydrate that accepts injected dependencies.
 *
 * Orchestrates npm-install → link using the composite execution pattern.
 * npm-install "fails" when its exitCode !== 0. Link always succeeds from
 * the composite's perspective (it handles its own failures internally).
 *
 * @param options - Hydrate command options
 * @param deps - Injectable dependencies (sub-command executors)
 * @returns Structured HydrateOutput with success flag and trace
 */
export async function executeHydrateWithDeps(
  options: HydrateOptions = {},
  deps: HydrateDeps
): Promise<HydrateOutput> {
  const projectPath = options.projectPath || process.cwd();

  const steps: CompositeStep[] = [
    {
      name: "npm-install",
      execute: async () => {
        const output = await deps.executeNpmInstall({
          projectPath,
          ignoreScripts: options.ignoreScripts,
          json: options.json,
        });
        // npm-install "fails" when exitCode !== 0
        return { success: output.exitCode === 0, output };
      },
    },
    {
      name: "link",
      execute: async () => {
        const output = await deps.executeLink({
          plan: options.plan,
          planData: options.planData,
          projectPath,
          json: options.json,
        });
        // Link always succeeds from composite perspective
        return { success: true, output };
      },
    },
  ];

  const result = await executeComposite<HydrateOutput>(steps, { projectPath });
  return result.output;
}
