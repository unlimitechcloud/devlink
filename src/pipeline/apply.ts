/**
 * Apply Command — Composite orchestrator for inject → hydrate sequence.
 *
 * Executes inject first; if it throws (indicating failure), skips hydrate and
 * reports `success: false`. Otherwise executes hydrate and collects both outputs
 * into a trace with keys "inject" and "hydrate".
 *
 * Accepts stage and plan input and propagates them to sub-commands. Uses the
 * generic `executeComposite` utility for fail-fast semantics and trace collection.
 * Supports dependency injection for testability.
 */

import { executeComposite, type CompositeStep } from "./composite.js";
import { executeInject } from "./inject.js";
import { executeHydrate } from "./hydrate.js";
import type {
  ApplyOptions,
  ApplyOutput,
  InjectOutput,
  HydrateOutput,
} from "./types.js";

// ============================================================================
// Dependency Injection Interface (for testability)
// ============================================================================

/**
 * Injectable dependencies for the apply command.
 *
 * Allows unit tests to provide mock implementations of sub-commands
 * without executing real filesystem operations or npm processes.
 */
export interface ApplyDeps {
  executeInject: (options: { stage?: string; plan?: string; stageData?: any; planData?: any; projectPath?: string; json?: boolean }) => Promise<InjectOutput>;
  executeHydrate: (options: { plan?: string; planData?: any; projectPath?: string; ignoreScripts?: boolean; json?: boolean }) => Promise<HydrateOutput>;
}

// ============================================================================
// Default Dependencies
// ============================================================================

function createDefaultDeps(): ApplyDeps {
  return {
    executeInject,
    executeHydrate,
  };
}

// ============================================================================
// Apply Execution
// ============================================================================

/**
 * Executes the apply composite command — inject → hydrate.
 *
 * Public entry point for production use. Delegates to `executeApplyWithDeps`
 * with real sub-command implementations.
 *
 * @param options - Apply command options (stage, plan, projectPath, ignoreScripts, json)
 * @returns Structured ApplyOutput with success flag and trace
 */
export async function executeApply(options: ApplyOptions = {}): Promise<ApplyOutput> {
  return executeApplyWithDeps(options, createDefaultDeps());
}

/**
 * Testable version of executeApply that accepts injected dependencies.
 *
 * Orchestrates inject → hydrate using the composite execution pattern.
 * Inject "fails" if it throws an exception (it doesn't have a success field).
 * Hydrate "fails" if its success field is false.
 *
 * @param options - Apply command options
 * @param deps - Injectable dependencies (sub-command executors)
 * @returns Structured ApplyOutput with success flag and trace
 */
export async function executeApplyWithDeps(
  options: ApplyOptions = {},
  deps: ApplyDeps
): Promise<ApplyOutput> {
  const projectPath = options.projectPath || process.cwd();

  const steps: CompositeStep[] = [
    {
      name: "inject",
      execute: async () => {
        try {
          const output = await deps.executeInject({
            stage: options.stage,
            plan: options.plan,
            stageData: options.stageData,
            planData: options.planData,
            projectPath,
            json: options.json,
          });
          // Inject succeeds if it doesn't throw
          return { success: true, output };
        } catch (error) {
          // Inject "fails" on exception — report failure with error info
          return {
            success: false,
            output: { error: error instanceof Error ? error.message : String(error) },
          };
        }
      },
    },
    {
      name: "hydrate",
      execute: async () => {
        const output = await deps.executeHydrate({
          plan: options.plan,
          planData: options.planData,
          projectPath,
          ignoreScripts: options.ignoreScripts,
          json: options.json,
        });
        // Hydrate reports its own success field
        return { success: output.success, output };
      },
    },
  ];

  const result = await executeComposite<ApplyOutput>(steps, { projectPath });
  return result.output;
}
