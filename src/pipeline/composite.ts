/**
 * Composite Execution Utility — Generic orchestrator for composite pipeline commands.
 *
 * Provides the `executeComposite` function that implements the fail-fast pattern
 * for composite commands (hydrate, apply, install). Each step is executed in order;
 * if any step reports failure, subsequent steps are skipped and the composite reports
 * `success: false`. Supports recursive nesting — composites within composites produce
 * nested traces automatically since each sub-composite's output already contains its
 * own trace.
 *
 * The trace collects outputs keyed by sub-command name, enabling programmatic inspection
 * of the full execution history by external tools.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A single step in a composite command execution.
 *
 * Each step has a name (used as the trace key) and an execute function that
 * returns a success flag and the step's output. The output is stored in the
 * trace regardless of success/failure.
 */
export interface CompositeStep {
  /** Name of the sub-command, used as the key in the trace object */
  name: string;
  /** Executes the sub-command and returns success status + output */
  execute: () => Promise<{ success: boolean; output: unknown }>;
}

/**
 * Result of a composite command execution.
 *
 * Contains the overall success flag and the assembled output object
 * including the trace of all executed sub-commands.
 */
export interface CompositeResult<T> {
  success: boolean;
  output: T;
}

// ============================================================================
// Composite Execution
// ============================================================================

/**
 * Executes a sequence of pipeline steps with fail-fast semantics and trace collection.
 *
 * Iterates through the steps array in order. For each step:
 * 1. Calls step.execute() to run the sub-command
 * 2. Records the output in the trace under step.name
 * 3. If the step reports failure (success: false), stops immediately
 *
 * The trace is always included in the output, containing outputs of all executed
 * steps (including the failed one). Steps after a failure are never executed.
 *
 * Supports recursive nesting: when a step is itself a composite command, its output
 * already contains its own trace, which gets nested naturally in the parent trace.
 *
 * @param steps - Ordered array of sub-commands to execute
 * @param baseOutput - Base fields for the output object (e.g., projectPath)
 * @returns Composite result with success flag and assembled output including trace
 */
export async function executeComposite<T>(
  steps: CompositeStep[],
  baseOutput: Record<string, unknown>
): Promise<CompositeResult<T>> {
  const trace: Record<string, unknown> = {};

  for (const step of steps) {
    const result = await step.execute();
    trace[step.name] = result.output;

    if (!result.success) {
      return {
        success: false,
        output: { ...baseOutput, success: false, trace } as unknown as T,
      };
    }
  }

  return {
    success: true,
    output: { ...baseOutput, success: true, trace } as unknown as T,
  };
}
