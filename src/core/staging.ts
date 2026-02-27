/**
 * Staging - Copy resolved packages to local staging and rewrite internal dependencies.
 */

import fs from "fs/promises";
import path from "path";
import semver from "semver";
import type { ResolvedPackage, PackageManifest } from "../types.js";

/** Staging directory inside the project */
export const STAGING_DIR = ".devlink";

export interface StagingResult {
  /** Packages copied to staging */
  staged: StagedPackage[];
  /** Dependencies rewritten to file: */
  relinked: RelinkDetail[];
}

export interface StagedPackage {
  name: string;
  version: string;
  namespace: string;
  /** Absolute path in .devlink/ */
  stagingPath: string;
}

export interface RelinkDetail {
  /** Package that was modified */
  package: string;
  /** Dependency rewritten */
  dep: string;
  /** Original value (e.g., "^0.1.0") */
  from: string;
  /** Rewritten value (e.g., "file:../../@webforgeai/core") */
  to: string;
}

/**
 * Copy directory recursively
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
 * Copy resolved packages to local staging and rewrite internal dependencies.
 *
 * 1. Clean .devlink/ if exists
 * 2. Copy each resolved package from store to .devlink/{name}/
 * 3. Build index of packages available in staging
 * 4. For each package, rewrite internal deps to file: relative paths
 */
export async function stageAndRelink(
  projectPath: string,
  resolvedPackages: ResolvedPackage[],
  syntheticPackages?: Set<string>
): Promise<StagingResult> {
  const stagingDir = path.join(projectPath, STAGING_DIR);
  const result: StagingResult = { staged: [], relinked: [] };

  // 1. Clean existing staging
  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(stagingDir, { recursive: true });

  // 2. Copy packages from store to staging
  for (const pkg of resolvedPackages) {
    const destPath = path.join(stagingDir, pkg.name);
    await copyDir(pkg.path!, destPath);
    result.staged.push({
      name: pkg.name,
      version: pkg.version,
      namespace: pkg.namespace!,
      stagingPath: destPath,
    });
  }

  // 3. Build index: packageName → [{ version, path }]
  const availableInStaging = new Map<string, { version: string; path: string }[]>();
  for (const staged of result.staged) {
    const entries = availableInStaging.get(staged.name) || [];
    entries.push({ version: staged.version, path: staged.stagingPath });
    availableInStaging.set(staged.name, entries);
  }

  // 4. Re-link: rewrite internal deps to file: relative paths
  for (const staged of result.staged) {
    const manifestPath = path.join(staged.stagingPath, "package.json");
    let manifest: PackageManifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    } catch {
      continue; // Skip if no valid package.json
    }

    let modified = false;

    for (const depField of ["dependencies", "peerDependencies"] as const) {
      const deps = manifest[depField];
      if (!deps) continue;

      for (const [depName, depRange] of Object.entries(deps)) {
        const stagingEntries = availableInStaging.get(depName);
        if (!stagingEntries) continue;

        // Find best version that satisfies the range
        const versions = stagingEntries.map(e => e.version);
        const bestVersion = semver.maxSatisfying(versions, depRange);
        if (!bestVersion) continue;

        // Find the path of the package with that version
        const bestEntry = stagingEntries.find(e => e.version === bestVersion)!;
        const relativePath = path.relative(staged.stagingPath, bestEntry.path);
        const fileRef = `file:${relativePath}`;

        result.relinked.push({
          package: `${staged.name}@${staged.version}`,
          dep: depName,
          from: depRange,
          to: fileRef,
        });

        deps[depName] = fileRef;
        modified = true;
      }
    }

    if (modified) {
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  return result;
}
