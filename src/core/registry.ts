/**
 * Registry - Gestión del registry.json
 */

import fs from "fs/promises";
import type { Registry, NamespaceEntry, PackageEntry, VersionEntry } from "../types.js";
import {
  getStorePath,
  getRegistryPath,
  REGISTRY_VERSION,
  DEFAULT_NAMESPACE,
} from "../constants.js";

/**
 * Create an empty registry
 */
export function createEmptyRegistry(): Registry {
  return {
    version: REGISTRY_VERSION,
    namespaces: {
      [DEFAULT_NAMESPACE]: {
        created: new Date().toISOString(),
        packages: {},
      },
    },
  };
}

/**
 * Read registry from disk
 * Returns empty registry if file doesn't exist
 */
export async function readRegistry(): Promise<Registry> {
  const registryPath = getRegistryPath();
  
  try {
    const content = await fs.readFile(registryPath, "utf-8");
    const registry = JSON.parse(content) as Registry;
    
    // Ensure global namespace exists
    if (!registry.namespaces[DEFAULT_NAMESPACE]) {
      registry.namespaces[DEFAULT_NAMESPACE] = {
        created: new Date().toISOString(),
        packages: {},
      };
    }
    
    return registry;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return createEmptyRegistry();
    }
    throw error;
  }
}

/**
 * Write registry to disk (atomic write)
 */
export async function writeRegistry(registry: Registry): Promise<void> {
  const registryPath = getRegistryPath();
  const storePath = getStorePath();
  
  // Ensure store directory exists
  await fs.mkdir(storePath, { recursive: true });
  
  // Write to temp file first, then rename (atomic)
  const tempPath = `${registryPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(registry, null, 2));
  await fs.rename(tempPath, registryPath);
}


/**
 * Ensure a namespace exists in the registry
 */
export function ensureNamespaceInRegistry(
  registry: Registry,
  namespace: string
): void {
  if (!registry.namespaces[namespace]) {
    registry.namespaces[namespace] = {
      created: new Date().toISOString(),
      packages: {},
    };
  }
}

/**
 * Add or update a package version in the registry
 */
export function addPackageToRegistry(
  registry: Registry,
  namespace: string,
  packageName: string,
  version: string,
  entry: VersionEntry
): void {
  ensureNamespaceInRegistry(registry, namespace);
  
  const nsEntry = registry.namespaces[namespace];
  
  if (!nsEntry.packages[packageName]) {
    nsEntry.packages[packageName] = { versions: {} };
  }
  
  nsEntry.packages[packageName].versions[version] = entry;
}

/**
 * Remove a package version from the registry
 * Returns true if something was removed
 */
export function removePackageFromRegistry(
  registry: Registry,
  namespace: string,
  packageName: string,
  version?: string
): boolean {
  const nsEntry = registry.namespaces[namespace];
  if (!nsEntry) return false;
  
  const pkgEntry = nsEntry.packages[packageName];
  if (!pkgEntry) return false;
  
  if (version) {
    // Remove specific version
    if (!pkgEntry.versions[version]) return false;
    delete pkgEntry.versions[version];
    
    // Clean up empty package entry
    if (Object.keys(pkgEntry.versions).length === 0) {
      delete nsEntry.packages[packageName];
    }
  } else {
    // Remove entire package
    delete nsEntry.packages[packageName];
  }
  
  return true;
}

/**
 * Get a package entry from the registry
 */
export function getPackageFromRegistry(
  registry: Registry,
  namespace: string,
  packageName: string
): PackageEntry | null {
  const nsEntry = registry.namespaces[namespace];
  if (!nsEntry) return null;
  
  return nsEntry.packages[packageName] || null;
}

/**
 * Get a specific version entry from the registry
 */
export function getVersionFromRegistry(
  registry: Registry,
  namespace: string,
  packageName: string,
  version: string
): VersionEntry | null {
  const pkgEntry = getPackageFromRegistry(registry, namespace, packageName);
  if (!pkgEntry) return null;
  
  return pkgEntry.versions[version] || null;
}

/**
 * Check if a namespace exists in the registry
 */
export function namespaceExistsInRegistry(
  registry: Registry,
  namespace: string
): boolean {
  return namespace in registry.namespaces;
}

/**
 * Get all namespaces from the registry
 * Returns global first, then alphabetically sorted
 */
export function getNamespacesFromRegistry(registry: Registry): string[] {
  const namespaces = Object.keys(registry.namespaces);
  
  return namespaces.sort((a, b) => {
    if (a === DEFAULT_NAMESPACE) return -1;
    if (b === DEFAULT_NAMESPACE) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Get all packages in a namespace
 */
export function getPackagesInNamespace(
  registry: Registry,
  namespace: string
): string[] {
  const nsEntry = registry.namespaces[namespace];
  if (!nsEntry) return [];
  
  return Object.keys(nsEntry.packages).sort();
}

/**
 * Get all versions of a package in a namespace
 */
export function getVersionsInNamespace(
  registry: Registry,
  namespace: string,
  packageName: string
): string[] {
  const pkgEntry = getPackageFromRegistry(registry, namespace, packageName);
  if (!pkgEntry) return [];
  
  return Object.keys(pkgEntry.versions).sort();
}

/**
 * Remove a namespace from the registry
 * Cannot remove the global namespace
 */
export function removeNamespaceFromRegistry(
  registry: Registry,
  namespace: string
): boolean {
  if (namespace === DEFAULT_NAMESPACE) {
    throw new Error(`Cannot delete reserved namespace '${DEFAULT_NAMESPACE}'`);
  }
  
  if (!registry.namespaces[namespace]) {
    return false;
  }
  
  delete registry.namespaces[namespace];
  return true;
}

/**
 * Get total package count across all namespaces
 */
export function getTotalPackageCount(registry: Registry): number {
  let count = 0;
  for (const ns of Object.values(registry.namespaces)) {
    for (const pkg of Object.values(ns.packages)) {
      count += Object.keys(pkg.versions).length;
    }
  }
  return count;
}

/**
 * Find all namespaces containing a specific package
 */
export function findPackageInAllNamespaces(
  registry: Registry,
  packageName: string
): { namespace: string; versions: string[] }[] {
  const results: { namespace: string; versions: string[] }[] = [];
  
  for (const [ns, nsEntry] of Object.entries(registry.namespaces)) {
    const pkgEntry = nsEntry.packages[packageName];
    if (pkgEntry) {
      results.push({
        namespace: ns,
        versions: Object.keys(pkgEntry.versions).sort(),
      });
    }
  }
  
  // Sort: global first, then alphabetically
  return results.sort((a, b) => {
    if (a.namespace === DEFAULT_NAMESPACE) return -1;
    if (b.namespace === DEFAULT_NAMESPACE) return 1;
    return a.namespace.localeCompare(b.namespace);
  });
}

/**
 * Find all packages matching a scope (e.g., @webforgeai)
 */
export function findPackagesByScope(
  registry: Registry,
  scope: string
): { namespace: string; package: string; versions: string[] }[] {
  const results: { namespace: string; package: string; versions: string[] }[] = [];
  const scopePrefix = scope.endsWith("/") ? scope : `${scope}/`;
  
  for (const [ns, nsEntry] of Object.entries(registry.namespaces)) {
    for (const [pkgName, pkgEntry] of Object.entries(nsEntry.packages)) {
      if (pkgName.startsWith(scopePrefix) || pkgName === scope.replace(/\/$/, "")) {
        results.push({
          namespace: ns,
          package: pkgName,
          versions: Object.keys(pkgEntry.versions).sort(),
        });
      }
    }
  }
  
  return results;
}
