/**
 * Resolver - Algoritmo de resolución de paquetes
 */

import type { Registry, ResolutionResult } from "../types.js";
import { getPackagePath, DEFAULT_NAMESPACE } from "../constants.js";

/**
 * Resolve a single package across namespaces
 * Searches namespaces in order and returns the first match
 */
export function resolvePackage(
  packageName: string,
  version: string,
  namespaces: string[],
  registry: Registry
): ResolutionResult {
  const searchedNamespaces: string[] = [];
  
  // Ensure we have at least global namespace
  const nsToSearch = namespaces.length > 0 ? namespaces : [DEFAULT_NAMESPACE];
  
  for (const ns of nsToSearch) {
    searchedNamespaces.push(ns);
    
    const nsEntry = registry.namespaces[ns];
    if (!nsEntry) continue;
    
    const pkgEntry = nsEntry.packages[packageName];
    if (!pkgEntry) continue;
    
    const versionEntry = pkgEntry.versions[version];
    if (!versionEntry) continue;
    
    return {
      package: packageName,
      version,
      found: true,
      namespace: ns,
      path: getPackagePath(ns, packageName, version),
      signature: versionEntry.signature,
      searchedNamespaces,
    };
  }
  
  return {
    package: packageName,
    version,
    found: false,
    searchedNamespaces,
  };
}

/**
 * Resolve multiple packages
 */
export function resolvePackages(
  packages: { name: string; version: string }[],
  namespaces: string[],
  registry: Registry
): ResolutionResult[] {
  return packages.map(pkg => 
    resolvePackage(pkg.name, pkg.version, namespaces, registry)
  );
}

/**
 * Find a package in a specific namespace only
 */
export function findInNamespace(
  packageName: string,
  version: string,
  namespace: string,
  registry: Registry
): ResolutionResult {
  return resolvePackage(packageName, version, [namespace], registry);
}

/**
 * Check if a package exists in any of the given namespaces
 */
export function packageExistsInNamespaces(
  packageName: string,
  version: string,
  namespaces: string[],
  registry: Registry
): boolean {
  const result = resolvePackage(packageName, version, namespaces, registry);
  return result.found;
}

/**
 * Get all available versions of a package across namespaces
 */
export function getAllVersions(
  packageName: string,
  namespaces: string[],
  registry: Registry
): { namespace: string; version: string; signature: string }[] {
  const results: { namespace: string; version: string; signature: string }[] = [];
  
  const nsToSearch = namespaces.length > 0 ? namespaces : Object.keys(registry.namespaces);
  
  for (const ns of nsToSearch) {
    const nsEntry = registry.namespaces[ns];
    if (!nsEntry) continue;
    
    const pkgEntry = nsEntry.packages[packageName];
    if (!pkgEntry) continue;
    
    for (const [version, versionEntry] of Object.entries(pkgEntry.versions)) {
      results.push({
        namespace: ns,
        version,
        signature: versionEntry.signature,
      });
    }
  }
  
  return results;
}

/**
 * Parse package specifier (e.g., "@scope/pkg@1.0.0")
 */
export function parsePackageSpec(spec: string): { name: string; version: string } | null {
  // Handle scoped packages: @scope/name@version
  const scopedMatch = spec.match(/^(@[^/]+\/[^@]+)@(.+)$/);
  if (scopedMatch) {
    return { name: scopedMatch[1], version: scopedMatch[2] };
  }
  
  // Handle non-scoped packages: name@version
  const simpleMatch = spec.match(/^([^@]+)@(.+)$/);
  if (simpleMatch) {
    return { name: simpleMatch[1], version: simpleMatch[2] };
  }
  
  return null;
}

/**
 * Parse multiple package specifiers
 */
export function parsePackageSpecs(specs: string[]): { name: string; version: string }[] {
  const results: { name: string; version: string }[] = [];
  
  for (const spec of specs) {
    const parsed = parsePackageSpec(spec);
    if (parsed) {
      results.push(parsed);
    }
  }
  
  return results;
}

/**
 * Format resolution result for display
 */
export function formatResolutionResult(result: ResolutionResult): string {
  if (result.found) {
    return `✓ ${result.package}@${result.version} → ${result.namespace} (${result.signature?.slice(0, 8)})`;
  }
  
  return `✗ ${result.package}@${result.version} not found (searched: ${result.searchedNamespaces.join(", ")})`;
}

/**
 * Batch format resolution results
 */
export function formatResolutionResults(results: ResolutionResult[]): string {
  return results.map(formatResolutionResult).join("\n");
}
