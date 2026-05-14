/**
 * Stage Command — Copies resolved packages from the store to `.devlink/` staging directory.
 *
 * Reads plan output (from file or stdin), copies each store-resolved package to
 * `.devlink/{package-name}/`, rewrites internal dependencies between staged packages
 * to `file:` relative paths using semver satisfaction checks, and produces structured
 * StageOutput. Does not modify original packages in the store.
 */

import fs from "fs/promises";
import path from "path";
import semver from "semver";
import { readPipelineInput } from "./input.js";
import { stageFromNpm } from "../core/staging.js";
import type {
  StageOptions,
  StageOutput,
  StagedEntry,
  RelinkEntry,
  PlanOutput,
  PlanPackageEntry,
} from "./types.js";

/** Staging directory name inside the project */
const STAGING_DIR = ".devlink";

// ============================================================================
// Dependency Injection Interface (for testability)
// ============================================================================

/**
 * Injectable dependencies for the stage command.
 *
 * Allows unit tests to provide mock implementations of filesystem operations
 * and npm staging without touching the real filesystem.
 */
export interface StageDeps {
  copyDir: (src: string, dest: string) => Promise<void>;
  rmDir: (dirPath: string) => Promise<void>;
  mkDir: (dirPath: string) => Promise<void>;
  readManifest: (manifestPath: string) => Promise<Record<string, any> | null>;
  writeManifest: (manifestPath: string, manifest: Record<string, any>) => Promise<void>;
  stageFromNpm: (projectPath: string, packageName: string, version: string) => Promise<string | null>;
}

// ============================================================================
// Filesystem Helpers
// ============================================================================

/**
 * Recursively copies a directory from src to dest.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Removes a directory recursively (no-op if it doesn't exist).
 */
async function rmDir(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

/**
 * Creates a directory recursively.
 */
async function mkDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Reads and parses a package.json manifest. Returns null if the file doesn't exist or is invalid.
 */
async function readManifest(manifestPath: string): Promise<Record<string, any> | null> {
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Writes a manifest object to a package.json file.
 */
async function writeManifest(manifestPath: string, manifest: Record<string, any>): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

// ============================================================================
// Default Dependencies
// ============================================================================

function createDefaultDeps(): StageDeps {
  return {
    copyDir,
    rmDir,
    mkDir,
    readManifest,
    writeManifest,
    stageFromNpm,
  };
}

// ============================================================================
// Stage Execution
// ============================================================================

/**
 * Executes the stage command — copies store packages to `.devlink/` and relinks internal deps.
 *
 * This is the public entry point for the stage pipeline step. It reads plan input,
 * copies packages from the store to the staging directory, rewrites internal dependencies
 * to `file:` relative paths, and produces structured output.
 *
 * @param options - Stage command options (plan file path, project path, json mode)
 * @returns Structured StageOutput with staged packages and relinked dependencies
 */
export async function executeStage(options: StageOptions = {}): Promise<StageOutput> {
  return executeStageWithDeps(options, createDefaultDeps());
}

/**
 * Testable version of executeStage that accepts injected dependencies.
 *
 * This function contains the core staging logic. The public `executeStage`
 * delegates to this with real implementations; tests can inject mocks.
 *
 * @param options - Stage command options
 * @param deps - Injectable dependencies (filesystem operations, npm staging)
 * @returns Structured StageOutput with staged packages and relinked dependencies
 */
export async function executeStageWithDeps(
  options: StageOptions = {},
  deps: StageDeps
): Promise<StageOutput> {
  // 1. Read plan input (from planData, file path, or stdin)
  const plan = options.planData ?? await readPipelineInput<PlanOutput>(options.plan);

  // 2. Determine project path
  const projectPath = options.projectPath || plan.projectPath || process.cwd();
  const stagingDir = path.join(projectPath, STAGING_DIR);

  // 3. Clean and recreate staging directory
  await deps.rmDir(stagingDir);
  await deps.mkDir(stagingDir);

  // 4. Copy store packages to staging
  const staged: StagedEntry[] = [];

  for (const pkg of plan.packages.store) {
    const destPath = path.join(stagingDir, pkg.name);
    await deps.copyDir(pkg.path, destPath);
    staged.push({
      name: pkg.name,
      version: pkg.version,
      path: destPath,
    });
  }

  // 5. Stage registry packages from npm (synthetic packages that need npm pack)
  for (const pkg of plan.packages.registry) {
    const result = await deps.stageFromNpm(projectPath, pkg.name, pkg.version);
    if (result) {
      staged.push({
        name: pkg.name,
        version: pkg.version,
        path: result,
      });
    }
  }

  // 6. Rewrite internal dependencies between staged packages to file: relative paths
  const relinked = await relinkInternalDeps(staged, deps);

  return {
    projectPath,
    stagingDir: STAGING_DIR,
    staged,
    relinked,
  };
}

/**
 * Rewrites internal dependencies between staged packages to `file:` relative paths.
 *
 * For each staged package, reads its package.json and checks if any of its
 * dependencies or peerDependencies reference another staged package. If the
 * staged version satisfies the dependency's semver range, the dependency is
 * rewritten to a `file:` relative path.
 *
 * @param staged - Array of staged package entries with absolute paths
 * @param deps - Injectable dependencies for reading/writing manifests
 * @returns Array of relink entries describing each rewritten dependency
 */
async function relinkInternalDeps(
  staged: StagedEntry[],
  deps: StageDeps
): Promise<RelinkEntry[]> {
  const relinked: RelinkEntry[] = [];

  // Build index: packageName → { version, absPath }
  const availableIndex = new Map<string, { version: string; absPath: string }>();
  for (const entry of staged) {
    availableIndex.set(entry.name, {
      version: entry.version,
      absPath: entry.path,
    });
  }

  // Rewrite internal dependencies
  for (const entry of staged) {
    const manifestPath = path.join(entry.path, "package.json");
    const manifest = await deps.readManifest(manifestPath);
    if (!manifest) continue;

    let modified = false;

    for (const depField of ["dependencies", "peerDependencies"] as const) {
      const deps_section = manifest[depField];
      if (!deps_section || typeof deps_section !== "object") continue;

      for (const [depName, depRange] of Object.entries(deps_section)) {
        if (typeof depRange !== "string") continue;

        const available = availableIndex.get(depName);
        if (!available) continue;

        // Only rewrite if the staged version satisfies the semver range
        if (!semver.satisfies(available.version, depRange)) continue;

        const relativePath = path.relative(entry.path, available.absPath);
        const fileRef = `file:${relativePath}`;

        relinked.push({
          package: entry.name,
          dep: depName,
          from: depRange,
          to: fileRef,
        });

        deps_section[depName] = fileRef;
        modified = true;
      }
    }

    if (modified) {
      await deps.writeManifest(manifestPath, manifest);
    }
  }

  return relinked;
}
