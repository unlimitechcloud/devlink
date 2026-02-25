/**
 * Resolve Command - Resolver paquetes en namespaces
 */

import { readRegistry } from "../core/registry.js";
import {
  resolvePackages,
  parsePackageSpecs,
  formatResolutionResults,
} from "../core/resolver.js";
import { formatResolutionFlat } from "../formatters/flat.js";
import { DEFAULT_NAMESPACE } from "../constants.js";

export interface ResolveOptions {
  namespaces?: string[];
  flat?: boolean;
  path?: boolean;
}

/**
 * Resolve packages in namespaces
 */
export async function resolvePackagesCommand(
  specs: string[],
  options: ResolveOptions = {}
): Promise<string> {
  const registry = await readRegistry();
  const packages = parsePackageSpecs(specs);
  
  if (packages.length === 0) {
    throw new Error("No valid package specifications provided. Use format: pkg@version");
  }
  
  const namespaces = options.namespaces && options.namespaces.length > 0
    ? options.namespaces
    : [DEFAULT_NAMESPACE];
  
  const results = resolvePackages(packages, namespaces, registry);
  
  if (options.path) {
    // Output only resolved paths, one per line (machine-readable)
    return results
      .map(r => r.found && r.path ? r.path : '')
      .filter(Boolean)
      .join('\n');
  }
  
  if (options.flat) {
    return formatResolutionFlat(results);
  }
  
  return formatResolutionResults(results);
}

/**
 * CLI handler for resolve command
 */
export async function handleResolve(args: {
  specs: string[];
  namespaces?: string[];
  flat?: boolean;
  path?: boolean;
}): Promise<void> {
  try {
    const output = await resolvePackagesCommand(args.specs, {
      namespaces: args.namespaces,
      flat: args.flat,
      path: args.path,
    });
    
    console.log(output);
    
    // Exit with error if any package not found
    const registry = await readRegistry();
    const packages = parsePackageSpecs(args.specs);
    const namespaces = args.namespaces && args.namespaces.length > 0
      ? args.namespaces
      : [DEFAULT_NAMESPACE];
    const results = resolvePackages(packages, namespaces, registry);
    
    if (results.some(r => !r.found)) {
      process.exit(2);
    }
  } catch (error: any) {
    console.error(`✗ Resolve failed: ${error.message}`);
    process.exit(1);
  }
}
