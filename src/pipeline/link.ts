/**
 * Link Command — Executes npm link for packages with local path references.
 *
 * Reads plan output to get link package entries, then spawns `npm link <resolved-path>`
 * for each entry. Processes all entries regardless of individual failures (resilient),
 * recording successes in `linked[]` and failures in `failed[]` with exit codes.
 *
 * Uses dependency injection for the spawn function to enable unit testing
 * without actually invoking npm processes.
 */

import path from "path";
import { spawn } from "child_process";
import { readPipelineInput } from "./input.js";
import type {
  LinkOptions,
  LinkOutput,
  LinkedEntry,
  FailedLinkEntry,
  PlanOutput,
  PlanLinkEntry,
} from "./types.js";

// ============================================================================
// Dependency Injection Interface (for testability)
// ============================================================================

/**
 * Result of spawning an npm link subprocess.
 */
export interface SpawnLinkResult {
  exitCode: number;
}

/**
 * Injectable dependencies for the link command.
 *
 * Allows unit tests to provide a mock spawn implementation
 * without invoking real npm processes.
 */
export interface LinkDeps {
  spawnLink: (resolvedPath: string, projectPath: string) => Promise<SpawnLinkResult>;
}

// ============================================================================
// Default Spawn Implementation
// ============================================================================

/**
 * Spawns `npm link <resolvedPath>` in the given project directory.
 * Returns the exit code without throwing on non-zero exits.
 */
function defaultSpawnLink(resolvedPath: string, projectPath: string): Promise<SpawnLinkResult> {
  return new Promise<SpawnLinkResult>((resolve) => {
    const child = spawn("npm", ["link", resolvedPath], {
      cwd: projectPath,
      stdio: "pipe",
    });

    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1 });
    });

    child.on("error", () => {
      resolve({ exitCode: 1 });
    });
  });
}

// ============================================================================
// Default Dependencies
// ============================================================================

function createDefaultDeps(): LinkDeps {
  return {
    spawnLink: defaultSpawnLink,
  };
}

// ============================================================================
// Link Execution
// ============================================================================

/**
 * Executes the link command — spawns npm link for each link package in the plan.
 *
 * This is the public entry point for the link pipeline step. It reads plan input,
 * spawns npm link for each link entry, and produces structured output reporting
 * successes and failures.
 *
 * @param options - Link command options (plan file path, project path, json mode)
 * @returns Structured LinkOutput with linked[] and failed[] arrays
 */
export async function executeLink(options: LinkOptions = {}): Promise<LinkOutput> {
  return executeLinkWithDeps(options, createDefaultDeps());
}

/**
 * Testable version of executeLink that accepts injected dependencies.
 *
 * This function contains the core link logic. The public `executeLink`
 * delegates to this with real implementations; tests can inject mocks.
 *
 * @param options - Link command options
 * @param deps - Injectable dependencies (spawn function)
 * @returns Structured LinkOutput with linked[] and failed[] arrays
 */
export async function executeLinkWithDeps(
  options: LinkOptions = {},
  deps: LinkDeps
): Promise<LinkOutput> {
  // 1. Read plan input to get link entries
  const plan = options.planData ?? await readPipelineInput<PlanOutput>(options.plan);

  // 2. Determine project path (options > plan > cwd)
  const projectPath = options.projectPath || plan.projectPath || process.cwd();

  // 3. Extract link entries from plan
  const linkEntries = plan.packages.link;

  // 4. Process each link entry — resilient (continue on failure)
  const linked: LinkedEntry[] = [];
  const failed: FailedLinkEntry[] = [];

  for (const entry of linkEntries) {
    // Resolve relative paths against the project path
    const resolvedPath = path.isAbsolute(entry.path)
      ? entry.path
      : path.resolve(projectPath, entry.path);

    const result = await deps.spawnLink(resolvedPath, projectPath);

    if (result.exitCode === 0) {
      linked.push({ name: entry.name, path: resolvedPath });
    } else {
      failed.push({ name: entry.name, path: resolvedPath, exitCode: result.exitCode });
    }
  }

  return {
    projectPath,
    linked,
    failed,
  };
}
