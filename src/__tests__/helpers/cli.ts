/**
 * CLI Execution Utility — Spawns the compiled DevLink CLI binary as a subprocess.
 *
 * Provides a no-throw interface for executing CLI commands in tests. Always includes
 * --repo to isolate the store per test suite. Automatically parses stdout as JSON
 * when the output looks like a JSON object or array.
 */

import { execFileSync } from "child_process";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "../../../dist/cli.js");

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: any | null;
}

export interface CliOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Path to the temp store (passed as --repo) */
  repo: string;
  /** Environment variables to set */
  env?: Record<string, string>;
}

/**
 * Execute the DevLink CLI binary as a subprocess.
 *
 * Always includes --repo to isolate the store. Parses stdout as JSON
 * when the output looks like JSON (starts with { or [). Never throws —
 * non-zero exit codes are captured in the result for assertion.
 *
 * @param args - CLI arguments (e.g., ["publish", "--json", "-n", "feature"])
 * @param options - Execution options (cwd, repo, env)
 * @returns Result with exitCode, stdout, stderr, and parsed json
 */
export function execCli(args: string[], options: CliOptions): CliResult {
  const fullArgs = [CLI_PATH, "--repo", options.repo, ...args];
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  try {
    stdout = execFileSync("node", fullArgs, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }) as string;
  } catch (error: any) {
    exitCode = error.status ?? 1;
    stdout = error.stdout?.toString() || "";
    stderr = error.stderr?.toString() || "";
  }

  // Parse JSON if stdout looks like JSON
  let json: any | null = null;
  const trimmed = stdout.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      json = JSON.parse(trimmed);
    } catch {
      // Not valid JSON, leave as null
    }
  }

  return { exitCode, stdout, stderr, json };
}
