/**
 * Store - Operaciones de filesystem para el store
 */

import fs from "fs/promises";
import path from "path";
import {
  getStorePath,
  getNamespacesPath,
  getNamespacePath,
  getPackagePath,
  DEFAULT_NAMESPACE,
  SIGNATURE_FILE,
} from "../constants.js";

/**
 * Ensure the store base directory exists
 */
export async function ensureStore(): Promise<void> {
  const storePath = getStorePath();
  await fs.mkdir(storePath, { recursive: true });
}

/**
 * Ensure a namespace directory exists
 */
export async function ensureNamespace(namespace: string): Promise<void> {
  const nsPath = getNamespacePath(namespace);
  await fs.mkdir(nsPath, { recursive: true });
}

/**
 * Check if a namespace exists on disk
 */
export async function namespaceExists(namespace: string): Promise<boolean> {
  const nsPath = getNamespacePath(namespace);
  try {
    const stat = await fs.stat(nsPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * List all namespaces on disk
 * Returns global first, then alphabetically sorted
 */
export async function listNamespaces(): Promise<string[]> {
  const namespacesPath = getNamespacesPath();
  
  try {
    const entries = await fs.readdir(namespacesPath, { withFileTypes: true });
    const namespaces = entries
      .filter(e => e.isDirectory())
      .map(e => e.name);
    
    return namespaces.sort((a, b) => {
      if (a === DEFAULT_NAMESPACE) return -1;
      if (b === DEFAULT_NAMESPACE) return 1;
      return a.localeCompare(b);
    });
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Check if a package version exists on disk
 */
export async function packageVersionExists(
  namespace: string,
  packageName: string,
  version: string
): Promise<boolean> {
  const pkgPath = getPackagePath(namespace, packageName, version);
  try {
    const stat = await fs.stat(pkgPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}


/**
 * List all packages in a namespace
 */
export async function listPackagesInNamespace(namespace: string): Promise<string[]> {
  const nsPath = getNamespacePath(namespace);
  
  try {
    const entries = await fs.readdir(nsPath, { withFileTypes: true });
    const packages: string[] = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      // Check if it's a scoped package (@scope/name)
      if (entry.name.startsWith("@")) {
        const scopePath = path.join(nsPath, entry.name);
        const scopeEntries = await fs.readdir(scopePath, { withFileTypes: true });
        
        for (const scopeEntry of scopeEntries) {
          if (scopeEntry.isDirectory()) {
            packages.push(`${entry.name}/${scopeEntry.name}`);
          }
        }
      } else {
        packages.push(entry.name);
      }
    }
    
    return packages.sort();
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * List all versions of a package in a namespace
 */
export async function listVersionsInNamespace(
  namespace: string,
  packageName: string
): Promise<string[]> {
  const pkgBasePath = path.join(getNamespacePath(namespace), packageName);
  
  try {
    const entries = await fs.readdir(pkgBasePath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Delete a package version from disk
 */
export async function deletePackageVersion(
  namespace: string,
  packageName: string,
  version: string
): Promise<void> {
  const pkgPath = getPackagePath(namespace, packageName, version);
  await fs.rm(pkgPath, { recursive: true, force: true });
  
  // Clean up empty parent directories
  await cleanupEmptyParents(pkgPath, getNamespacePath(namespace));
}

/**
 * Delete an entire package from disk (all versions)
 */
export async function deletePackage(
  namespace: string,
  packageName: string
): Promise<void> {
  const pkgBasePath = path.join(getNamespacePath(namespace), packageName);
  await fs.rm(pkgBasePath, { recursive: true, force: true });
  
  // Clean up empty scope directory if scoped package
  if (packageName.startsWith("@")) {
    const scopePath = path.dirname(pkgBasePath);
    await cleanupEmptyParents(pkgBasePath, getNamespacePath(namespace));
  }
}

/**
 * Delete an entire namespace from disk
 * Cannot delete the global namespace
 */
export async function deleteNamespace(namespace: string): Promise<void> {
  if (namespace === DEFAULT_NAMESPACE) {
    throw new Error(`Cannot delete reserved namespace '${DEFAULT_NAMESPACE}'`);
  }
  
  const nsPath = getNamespacePath(namespace);
  await fs.rm(nsPath, { recursive: true, force: true });
}

/**
 * Clean up empty parent directories up to a limit
 */
async function cleanupEmptyParents(startPath: string, limitPath: string): Promise<void> {
  let currentPath = path.dirname(startPath);
  
  while (currentPath !== limitPath && currentPath.startsWith(limitPath)) {
    try {
      const entries = await fs.readdir(currentPath);
      if (entries.length === 0) {
        await fs.rmdir(currentPath);
        currentPath = path.dirname(currentPath);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

/**
 * Read signature file from a package
 */
export async function readPackageSignature(
  namespace: string,
  packageName: string,
  version: string
): Promise<string | null> {
  const sigPath = path.join(
    getPackagePath(namespace, packageName, version),
    SIGNATURE_FILE
  );
  
  try {
    return (await fs.readFile(sigPath, "utf-8")).trim();
  } catch {
    return null;
  }
}

/**
 * Write signature file to a package
 */
export async function writePackageSignature(
  namespace: string,
  packageName: string,
  version: string,
  signature: string
): Promise<void> {
  const sigPath = path.join(
    getPackagePath(namespace, packageName, version),
    SIGNATURE_FILE
  );
  
  await fs.writeFile(sigPath, signature);
}

/**
 * Get disk usage for a namespace
 */
export async function getNamespaceDiskUsage(namespace: string): Promise<number> {
  const nsPath = getNamespacePath(namespace);
  return getDirSize(nsPath);
}

/**
 * Get directory size recursively
 */
async function getDirSize(dirPath: string): Promise<number> {
  let size = 0;
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        size += await getDirSize(entryPath);
      } else {
        const stat = await fs.stat(entryPath);
        size += stat.size;
      }
    }
  } catch {
    // Ignore errors
  }
  
  return size;
}

/**
 * Find orphaned packages on disk (not in registry)
 */
export async function findOrphanedPackages(
  namespace: string,
  registeredPackages: Set<string>
): Promise<{ packageName: string; version: string }[]> {
  const orphans: { packageName: string; version: string }[] = [];
  const packages = await listPackagesInNamespace(namespace);
  
  for (const pkgName of packages) {
    const versions = await listVersionsInNamespace(namespace, pkgName);
    
    for (const version of versions) {
      const key = `${pkgName}@${version}`;
      if (!registeredPackages.has(key)) {
        orphans.push({ packageName: pkgName, version });
      }
    }
  }
  
  return orphans;
}
