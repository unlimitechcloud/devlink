/**
 * Tree Scanner - Discovers and classifies the complete structure of a monorepo recursively.
 *
 * Produces a tool-agnostic MonorepoTree with modules, install levels, and isolated packages.
 * Compatible with Node 18+ (no fs.glob dependency).
 */

import fs from "fs/promises";
import path from "path";
import type {
  MonorepoModule,
  MonorepoTree,
  InstallLevel,
  ScanOptions,
  ModuleType,
  PackageManifest,
} from "../types.js";


// ============================================================================
// Public API
// ============================================================================

/**
 * Scan a monorepo directory and produce a MonorepoTree.
 *
 * Reads the root package.json, resolves workspace globs, detects sub-monorepos,
 * identifies isolated packages, and classifies each module by heuristics.
 *
 * @param rootDir - Absolute path to the monorepo root
 * @param options - Scan options (maxDepth, etc.)
 * @returns MonorepoTree with modules, installLevels, and isolatedPackages
 */
export async function scanTree(
  rootDir: string,
  options?: ScanOptions,
): Promise<MonorepoTree> {
  const maxDepth = options?.maxDepth ?? 3;
  const resolvedRoot = path.resolve(rootDir);

  const rootPkg = await readPackageJson(resolvedRoot);
  if (!rootPkg) {
    throw new Error(
      `No package.json found in ${resolvedRoot}. Expected a package.json with a "workspaces" field.`,
    );
  }

  const rootWorkspaces: string[] = extractWorkspaces(rootPkg);
  if (rootWorkspaces.length === 0) {
    throw new Error(
      `package.json in ${resolvedRoot} has no "workspaces" field. The tree scanner requires a monorepo root with workspaces.`,
    );
  }

  const modules: MonorepoModule[] = [];
  const installLevels: InstallLevel[] = [];
  const isolatedPackages: string[] = [];

  // Register root as installLevels[0]
  installLevels.push({
    path: resolvedRoot,
    relativePath: ".",
    workspaces: rootWorkspaces,
  });

  // Resolve workspace globs to concrete paths
  const resolvedPaths = await resolveWorkspaceGlobs(resolvedRoot, rootWorkspaces);

  for (const wsPath of resolvedPaths) {
    const mod = await scanModule(wsPath, resolvedRoot, resolvedPaths);
    modules.push(mod);

    // If module has its own workspaces → sub-monorepo
    if (mod.hasWorkspaces && maxDepth > 1) {
      const subPkg = await readPackageJson(wsPath);
      const subWorkspaces = subPkg ? extractWorkspaces(subPkg) : [];
      installLevels.push({
        path: wsPath,
        relativePath: path.relative(resolvedRoot, wsPath),
        workspaces: subWorkspaces,
      });

      const subResolvedPaths = await resolveWorkspaceGlobs(wsPath, subWorkspaces);

      // List ALL sub-directories with package.json (not just those in globs)
      const allSubPackages = await listSubPackages(wsPath);

      for (const childPath of allSubPackages) {
        const child = await scanModule(childPath, resolvedRoot, subResolvedPaths);
        mod.children.push(child);

        // Detect isolated package: has package.json but NOT in parent's workspace globs
        if (!isPathInResolvedGlobs(childPath, subResolvedPaths)) {
          child.isIsolated = true;
          isolatedPackages.push(childPath);
        }
      }
    }
  }

  return { root: resolvedRoot, modules, installLevels, isolatedPackages };
}

/**
 * Classify a module by heuristics based on scripts, path patterns, package name,
 * and directory name.
 *
 * @param pkg - Parsed package.json manifest
 * @param modulePath - Absolute path to the module
 * @param rootDir - Absolute path to the monorepo root
 * @returns ModuleType classification
 */
export function classifyModule(
  pkg: PackageManifest,
  modulePath: string,
  rootDir: string,
): ModuleType {
  const scripts = pkg.scripts ?? {};
  const relativePath = path.relative(rootDir, modulePath);

  // Heuristic 1: Infrastructure scripts without build → infrastructure
  if (scripts["sst:dev"] && !scripts["build"]) return "infrastructure";
  if (scripts["sst:install"] && !scripts["build"]) return "infrastructure";

  // Heuristic 2: Path patterns
  if (relativePath.includes("/libs/") || relativePath.includes("/lib/")) return "library";
  if (relativePath.includes("/services/") || relativePath.includes("/service/")) return "service";
  if (relativePath.includes("/apps/") || relativePath.includes("/app/")) return "app";
  if (relativePath.includes("/cloud/") || relativePath.includes("/infra/")) return "infrastructure";

  // Heuristic 3: Package name patterns
  if (pkg.name?.includes(".libs.") || pkg.name?.includes("-lib")) return "library";
  if (pkg.name?.includes(".srv.") || pkg.name?.includes("-service")) return "service";
  if (pkg.name?.includes(".app.") || pkg.name?.includes("-app")) return "app";

  // Heuristic 4: Directory name (useful for children of sub-monorepos)
  const dirName = path.basename(modulePath);
  if (dirName === "connector") return "infrastructure";
  if (dirName === "service") return "service";
  if (dirName === "app") return "app";

  return "unknown";
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve workspace globs to concrete directory paths.
 *
 * Supports two common workspace glob forms:
 * - Wildcard: "packages/*" → all direct children of packages/ with package.json
 * - Exact: "packages/connector" → single directory if it has package.json
 *
 * Emits a warning (via console.warn) if a glob resolves to nothing, but does not throw.
 * Compatible with Node 18+ (no fs.glob dependency).
 *
 * @param baseDir - Directory containing the package.json with workspaces
 * @param globs - Workspace glob patterns (e.g. ["packages/*", "apps/web"])
 * @returns Array of absolute paths to resolved workspace directories
 */
export async function resolveWorkspaceGlobs(
  baseDir: string,
  globs: string[],
): Promise<string[]> {
  const results: string[] = [];

  for (const glob of globs) {
    const matched: string[] = [];

    if (glob.endsWith("/*")) {
      // Wildcard pattern: "some/path/*" → list direct children of "some/path/"
      const parentDir = path.resolve(baseDir, glob.slice(0, -2));
      try {
        const entries = await fs.readdir(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const fullPath = path.join(parentDir, entry.name);
          if (await fileExists(path.join(fullPath, "package.json"))) {
            matched.push(fullPath);
          }
        }
      } catch {
        // Parent directory doesn't exist — no matches
      }
    } else {
      // Exact path pattern: "packages/connector" → single directory
      const fullPath = path.resolve(baseDir, glob);
      if (await fileExists(path.join(fullPath, "package.json"))) {
        matched.push(fullPath);
      }
    }

    if (matched.length === 0) {
      console.warn(`Warning: workspace glob "${glob}" in ${baseDir} did not resolve to any directory`);
    }

    results.push(...matched);
  }

  // Deduplicate and sort for deterministic output
  const unique = [...new Set(results)];
  unique.sort();
  return unique;
}

/**
 * List all subdirectories with package.json inside a parent directory's packages/ folder.
 *
 * This discovers ALL sub-packages, including those not covered by workspace globs
 * (which become isolated packages).
 *
 * @param parentDir - The sub-monorepo directory to scan
 * @returns Array of absolute paths to sub-package directories
 */
export async function listSubPackages(parentDir: string): Promise<string[]> {
  const results: string[] = [];
  const packagesDir = path.join(parentDir, "packages");

  try {
    const entries = await fs.readdir(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidatePath = path.join(packagesDir, entry.name);
      if (await fileExists(path.join(candidatePath, "package.json"))) {
        results.push(candidatePath);
      }
    }
  } catch {
    // No packages/ directory — no sub-packages
  }

  results.sort();
  return results;
}

/**
 * Check if a target path is in the list of resolved glob paths.
 */
export function isPathInResolvedGlobs(
  targetPath: string,
  resolvedPaths: string[],
): boolean {
  const normalized = path.resolve(targetPath);
  return resolvedPaths.some((p) => path.resolve(p) === normalized);
}



/**
 * Read and parse a package.json from a directory.
 * Returns null if the file doesn't exist or is invalid JSON.
 */
export async function readPackageJson(dir: string): Promise<PackageManifest | null> {
  const filePath = path.join(dir, "package.json");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * Create a MonorepoModule from a directory path.
 *
 * Reads package.json, classifies the module, detects devlink config,
 * and extracts script names.
 */
async function scanModule(
  modulePath: string,
  rootDir: string,
  parentResolvedPaths: string[],
): Promise<MonorepoModule> {
  const pkg = await readPackageJson(modulePath);
  const name = pkg?.name ?? path.basename(modulePath);
  const scripts = pkg?.scripts ? Object.keys(pkg.scripts) : [];
  const workspaces = pkg ? extractWorkspaces(pkg) : [];
  const type = pkg ? classifyModule(pkg, modulePath, rootDir) : "unknown";

  return {
    name,
    path: modulePath,
    relativePath: path.relative(rootDir, modulePath),
    type,
    hasWorkspaces: workspaces.length > 0,
    isIsolated: false, // Set by caller if needed
    scripts,
    children: [],
  };
}

/**
 * Extract workspace globs from a package.json manifest.
 * Handles both array format and object format ({ packages: [...] }).
 */
function extractWorkspaces(pkg: PackageManifest): string[] {
  const ws = (pkg as any).workspaces;
  if (Array.isArray(ws)) return ws;
  if (ws && Array.isArray(ws.packages)) return ws.packages;
  return [];
}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
