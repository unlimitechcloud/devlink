/**
 * Multi-Level Installer - Orchestrates dependency installation across
 * root and isolated packages of a monorepo.
 *
 * Simplified model:
 * - Root level: DevLink staging + injection into root package.json + npm install
 *   Root npm install resolves ALL workspace members via hoisting.
 *   Workspace members resolve DevLink packages by Node walk-up to root/node_modules.
 * - Isolated packages: npm install only (no DevLink)
 *
 * Sub-monorepos are NOT installed separately — root npm handles them.
 */

import path from "path";
import { spawn } from "child_process";
import type {
  MultiLevelInstallOptions,
  MultiLevelInstallResult,
  LevelResult,
  InstallLevel,
} from "../types.js";
import { installPackages } from "../commands/install.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Install dependencies across root and isolated packages of a monorepo.
 *
 * Algorithm:
 * 1. Install at root: DevLink staging + root package.json injection + npm install
 * 2. For each isolated package: npm install (no DevLink)
 * 3. Fail-fast: if any level fails, stop immediately
 */
export async function installMultiLevel(
  options: MultiLevelInstallOptions,
): Promise<MultiLevelInstallResult> {
  const { tree, mode, runNpm, runScripts, config, configName, configKey } = options;
  const results: LevelResult[] = [];
  const startTime = Date.now();

  // Phase 1: Root — DevLink + npm install
  const rootLevel = tree.installLevels[0];
  console.log(`\n── Level 1: ${rootLevel.relativePath} (root) ──`);

  const rootResult = await installAtRootLevel(rootLevel, mode, runNpm, runScripts, config, configName, configKey);
  results.push(rootResult);

  if (!rootResult.success) {
    const totalDuration = Date.now() - startTime;
    console.log(`\n✗ Install failed at root: ${rootResult.error}`);
    return { levels: results, totalDuration, success: false };
  }

  console.log(`  ✓ Installed in ${(rootResult.duration / 1000).toFixed(1)}s`);

  // Log skipped sub-monorepos (informational)
  if (tree.installLevels.length > 1) {
    const skipped = tree.installLevels.length - 1;
    console.log(`\n  ℹ ${skipped} sub-monorepo(s) resolved by root workspace install`);
  }

  // Phase 2: Isolated packages — npm install only
  for (const isoPath of tree.isolatedPackages) {
    const isoLevel: InstallLevel = {
      path: isoPath,
      relativePath: path.relative(tree.root, isoPath),

      workspaces: [],
    };

    console.log(`\n── Isolated: ${isoLevel.relativePath} ──`);

    let isoResult: LevelResult;
    if (runNpm) {
      isoResult = await runNpmAtLevel(isoLevel, runScripts);
    } else {
      // No npm flag — skip
      isoResult = {
        path: isoLevel.path,
        relativePath: isoLevel.relativePath,
        success: true,
        duration: 0,
  
      };
    }
    results.push(isoResult);

    if (!isoResult.success) {
      const totalDuration = Date.now() - startTime;
      console.log(`  ✗ Failed: ${isoResult.error}`);
      return { levels: results, totalDuration, success: false };
    }

    if (isoResult.duration > 0) {
      console.log(`  ✓ Installed in ${(isoResult.duration / 1000).toFixed(1)}s`);
    }
  }

  const totalDuration = Date.now() - startTime;
  console.log(`\n✅ Install complete (${(totalDuration / 1000).toFixed(1)}s)`);
  return { levels: results, totalDuration, success: true };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Install at root level: DevLink staging + injection into root package.json + npm.
 * No tree is passed — injection is local to root only.
 */
async function installAtRootLevel(
  level: InstallLevel,
  mode: string,
  runNpm: boolean,
  runScripts?: boolean,
  configOverride?: string,
  configName?: string,
  configKey?: string,
): Promise<LevelResult> {
  const startTime = Date.now();
  const originalCwd = process.cwd();

  try {
    process.chdir(level.path);
    try {
      await installPackages({
        mode,
        runNpm,
        runScripts,
        config: configOverride,
        configName,
        configKey,
      });
      return {
        path: level.path,
        relativePath: level.relativePath,
        success: true,
        duration: Date.now() - startTime,

      };
    } finally {
      process.chdir(originalCwd);
    }
  } catch (error: any) {
    return {
      path: level.path,
      relativePath: level.relativePath,
      success: false,
      duration: Date.now() - startTime,

      error: error.message,
    };
  }
}

/**
 * Run only `npm install` at a given level. No DevLink.
 */
export async function runNpmAtLevel(
  level: InstallLevel,
  runScripts?: boolean,
): Promise<LevelResult> {
  const startTime = Date.now();
  const originalCwd = process.cwd();

  try {
    process.chdir(level.path);
    try {
      const exitCode = await runNpmInstall(runScripts);
      if (exitCode !== 0) {
        throw new Error(`npm install exited with code ${exitCode} at level: ${level.relativePath}`);
      }
      return {
        path: level.path,
        relativePath: level.relativePath,
        success: true,
        duration: Date.now() - startTime,
  
      };
    } finally {
      process.chdir(originalCwd);
    }
  } catch (error: any) {
    return {
      path: level.path,
      relativePath: level.relativePath,
      success: false,
      duration: Date.now() - startTime,

      error: error.message,
    };
  }
}

/**
 * Run `npm install` in the current directory.
 */
async function runNpmInstall(runScripts: boolean = false): Promise<number> {
  return new Promise((resolve) => {
    const args = ["install", "--no-audit", "--legacy-peer-deps"];
    if (!runScripts) {
      args.push("--ignore-scripts");
    }

    const npm = spawn("npm", args, {
      stdio: "inherit",
      shell: true,
    });

    npm.on("close", (code) => {
      resolve(code ?? 0);
    });

    npm.on("error", () => {
      resolve(1);
    });
  });
}
