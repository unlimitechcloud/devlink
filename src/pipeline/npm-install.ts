/**
 * NpmInstall Command — Spawns `npm install` in the project directory.
 *
 * Executes npm with `--no-audit --legacy-peer-deps` flags, optionally adding
 * `--ignore-scripts` when configured. Routes subprocess output based on the
 * OutputRouter's mode: piped to stderr in JSON mode, inherited in human mode.
 * Never throws on non-zero exit codes — reports them in structured output.
 */

import { spawn, type ChildProcess } from "child_process";
import type { NpmInstallOptions, NpmInstallOutput } from "./types.js";
import { createOutputRouter, type OutputRouter } from "./output-router.js";

// ============================================================================
// Dependency Injection Interface (for testability)
// ============================================================================

/**
 * Injectable dependencies for the npm-install command.
 *
 * Allows unit tests to provide a mock spawn function without executing
 * real npm processes.
 */
export interface NpmInstallDeps {
  /** Spawns a child process. Signature matches a subset of child_process.spawn. */
  spawnProcess: (
    command: string,
    args: string[],
    options: { cwd: string; stdio: "inherit" | ["pipe", "pipe", "pipe"] }
  ) => ChildProcess;
}

// ============================================================================
// Default Dependencies (real implementations)
// ============================================================================

/** Default deps using Node.js child_process.spawn. */
function createDefaultDeps(): NpmInstallDeps {
  return {
    spawnProcess: (command, args, options) => {
      return spawn(command, args, options);
    },
  };
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Executes npm install with dependency injection for testability.
 *
 * Spawns `npm install --no-audit --legacy-peer-deps` in the project directory.
 * When `ignoreScripts` is set, adds `--ignore-scripts` to the argument list.
 * Routes subprocess stdio based on JSON mode: piped to stderr when --json is
 * active, inherited directly when in human mode.
 *
 * @param options - NpmInstall command options (projectPath, ignoreScripts, json)
 * @param deps - Injectable dependencies for spawning processes
 * @returns Structured output with exit code and args used
 */
export async function executeNpmInstallWithDeps(
  options: NpmInstallOptions,
  deps: NpmInstallDeps
): Promise<NpmInstallOutput> {
  const projectPath = options.projectPath || process.cwd();
  const router: OutputRouter = createOutputRouter(options.json ?? false);

  // Build npm arguments
  const args = ["install", "--no-audit", "--legacy-peer-deps"];
  if (options.ignoreScripts) {
    args.push("--ignore-scripts");
  }

  // Determine stdio mode based on OutputRouter
  const stdioMode = router.subprocessStdio();

  // Spawn npm process
  const child = deps.spawnProcess("npm", args, {
    cwd: projectPath,
    stdio: stdioMode === "pipe" ? ["pipe", "pipe", "pipe"] : "inherit",
  });

  // When piped (JSON mode), route subprocess output to stderr
  if (stdioMode === "pipe") {
    child.stdout?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
  }

  // Wait for process to exit
  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
    child.on("error", () => {
      resolve(1);
    });
  });

  return {
    projectPath,
    exitCode,
    args,
  };
}

/**
 * Executes npm install using real system dependencies.
 *
 * Public entry point for production use. Delegates to `executeNpmInstallWithDeps`
 * with the default spawn implementation.
 *
 * @param options - NpmInstall command options
 * @returns Structured output with exit code and args used
 */
export async function executeNpmInstall(
  options: NpmInstallOptions
): Promise<NpmInstallOutput> {
  return executeNpmInstallWithDeps(options, createDefaultDeps());
}
