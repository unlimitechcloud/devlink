/**
 * Inject Command — Rewrites the project's package.json with dependency references.
 *
 * Reads stage output (to know which packages are staged and where) and plan output
 * (to know registry packages, removals, dev flags, and synthetic flags). Produces
 * structured InjectOutput describing all modifications made to package.json:
 * - file: entries for staged non-synthetic packages pointing to .devlink/ paths
 * - version string entries for registry packages
 * - removals for packages in the remove bucket
 * - synthetic packages are skipped (kept in .devlink/ but not injected)
 * - dev: true packages go to devDependencies instead of dependencies
 */

import path from "path";
import { readPipelineInput } from "./input.js";
import type {
  InjectOptions,
  InjectOutput,
  InjectedEntry,
  RegistryEntry,
  PlanOutput,
  StageOutput,
} from "./types.js";

// ============================================================================
// Dependency Injection Interface (for testability)
// ============================================================================

/**
 * Injectable dependencies for the inject command.
 *
 * Allows unit tests to provide mock implementations of filesystem operations
 * without touching the real filesystem.
 */
export interface InjectDeps {
  readManifest: (manifestPath: string) => Promise<Record<string, any>>;
  writeManifest: (manifestPath: string, manifest: Record<string, any>) => Promise<void>;
}

// ============================================================================
// Filesystem Helpers
// ============================================================================

import fs from "fs/promises";

/**
 * Reads and parses a package.json manifest from disk.
 * Throws if the file doesn't exist or contains invalid JSON.
 */
async function readManifest(manifestPath: string): Promise<Record<string, any>> {
  const raw = await fs.readFile(manifestPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Writes a manifest object to a package.json file with 2-space indentation.
 */
async function writeManifest(manifestPath: string, manifest: Record<string, any>): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

// ============================================================================
// Default Dependencies
// ============================================================================

function createDefaultDeps(): InjectDeps {
  return {
    readManifest,
    writeManifest,
  };
}

// ============================================================================
// Inject Execution
// ============================================================================

/**
 * Executes the inject command — rewrites package.json with dependency references.
 *
 * This is the public entry point for the inject pipeline step. It reads stage and
 * plan input, modifies the project's package.json, and produces structured output.
 *
 * @param options - Inject command options (stage/plan file paths, project path, json mode)
 * @returns Structured InjectOutput describing all package.json modifications
 */
export async function executeInject(options: InjectOptions = {}): Promise<InjectOutput> {
  return executeInjectWithDeps(options, createDefaultDeps());
}

/**
 * Testable version of executeInject that accepts injected dependencies.
 *
 * This function contains the core inject logic. The public `executeInject`
 * delegates to this with real implementations; tests can inject mocks.
 *
 * @param options - Inject command options
 * @param deps - Injectable dependencies (filesystem operations)
 * @returns Structured InjectOutput describing all package.json modifications
 */
export async function executeInjectWithDeps(
  options: InjectOptions = {},
  deps: InjectDeps
): Promise<InjectOutput> {
  // 1. Read stage and plan inputs (from data, file paths, or stdin)
  const stage = options.stageData ?? await readPipelineInput<StageOutput>(options.stage);
  const plan = options.planData ?? await readPipelineInput<PlanOutput>(options.plan);

  // 2. Determine project path (options > stage > plan > cwd)
  const projectPath = options.projectPath || stage.projectPath || plan.projectPath || process.cwd();

  // 3. Read the project's package.json
  const manifestPath = path.join(projectPath, "package.json");
  const manifest = await deps.readManifest(manifestPath);

  // Ensure dependencies and devDependencies objects exist
  if (!manifest.dependencies) manifest.dependencies = {};
  if (!manifest.devDependencies) manifest.devDependencies = {};

  // 4. Track modifications for output
  const injected: InjectedEntry[] = [];
  const registry: RegistryEntry[] = [];
  const removed: string[] = [];
  const synthetic: string[] = [];

  // 5. Build a lookup of staged package paths by name
  const stagedPaths = new Map<string, string>();
  for (const entry of stage.staged) {
    stagedPaths.set(entry.name, entry.path);
  }

  // 6. Build a lookup of plan store entries by name (for synthetic/dev flags)
  const storeEntries = new Map(plan.packages.store.map(e => [e.name, e]));
  const registryEntries = new Map(plan.packages.registry.map(e => [e.name, e]));

  // 7. Process store packages — inject file: entries for non-synthetic packages
  for (const pkg of plan.packages.store) {
    // Skip synthetic packages
    if (pkg.synthetic) {
      synthetic.push(pkg.name);
      continue;
    }

    const stagedPath = stagedPaths.get(pkg.name);
    if (!stagedPath) continue;

    // Compute the file: reference relative to the project path
    const relativeStagedPath = path.relative(projectPath, stagedPath);
    const fileRef = `file:${relativeStagedPath}`;

    // Determine target: devDependencies if dev flag is set
    const target = pkg.dev ? "devDependencies" : "dependencies";

    // Remove from the other section if it exists there
    const otherTarget = pkg.dev ? "dependencies" : "devDependencies";
    if (manifest[otherTarget]?.[pkg.name]) {
      delete manifest[otherTarget][pkg.name];
    }

    manifest[target][pkg.name] = fileRef;
    injected.push({ name: pkg.name, target, value: fileRef });
  }

  // 8. Process registry packages — inject version string entries
  for (const pkg of plan.packages.registry) {
    // Skip synthetic registry packages
    if (pkg.synthetic) {
      synthetic.push(pkg.name);
      continue;
    }

    // Determine target: devDependencies if dev flag is set
    const target = pkg.dev ? "devDependencies" : "dependencies";

    // Remove from the other section if it exists there
    const otherTarget = pkg.dev ? "dependencies" : "devDependencies";
    if (manifest[otherTarget]?.[pkg.name]) {
      delete manifest[otherTarget][pkg.name];
    }

    manifest[target][pkg.name] = pkg.version;
    registry.push({ name: pkg.name, target, value: pkg.version });
  }

  // 9. Process removals — remove from both dependencies and devDependencies
  for (const pkgName of plan.packages.remove) {
    let wasRemoved = false;

    if (manifest.dependencies?.[pkgName]) {
      delete manifest.dependencies[pkgName];
      wasRemoved = true;
    }
    if (manifest.devDependencies?.[pkgName]) {
      delete manifest.devDependencies[pkgName];
      wasRemoved = true;
    }

    if (wasRemoved) {
      removed.push(pkgName);
    }
  }

  // 10. Write the modified package.json
  await deps.writeManifest(manifestPath, manifest);

  return {
    projectPath,
    modified: manifestPath,
    injected,
    registry,
    removed,
    synthetic,
  };
}
