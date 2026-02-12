/**
 * List Command - Listar paquetes en el store
 */

import { readRegistry } from "../core/registry.js";
import { formatByNamespaceTree, formatByPackageTree } from "../formatters/tree.js";
import { formatByNamespaceFlat, formatByPackageFlat } from "../formatters/flat.js";

export interface ListOptions {
  namespaces?: string[];
  packages?: string[];
  flat?: boolean;
  byPackage?: boolean;
}

/**
 * List packages in the store
 */
export async function listPackages(options: ListOptions = {}): Promise<string> {
  const registry = await readRegistry();
  
  const { namespaces, packages, flat, byPackage } = options;
  
  if (byPackage || (packages && packages.length > 0)) {
    // List by package
    if (flat) {
      return formatByPackageFlat(registry, packages);
    }
    return formatByPackageTree(registry, packages);
  }
  
  // List by namespace (default)
  if (flat) {
    return formatByNamespaceFlat(registry, namespaces);
  }
  return formatByNamespaceTree(registry, namespaces);
}

/**
 * CLI handler for list command
 */
export async function handleList(args: {
  namespaces?: string[];
  packages?: string[];
  flat?: boolean;
}): Promise<void> {
  try {
    const byPackage = args.packages && args.packages.length > 0;
    const output = await listPackages({
      namespaces: args.namespaces,
      packages: args.packages,
      flat: args.flat,
      byPackage,
    });
    
    console.log(output);
  } catch (error: any) {
    console.error(`✗ List failed: ${error.message}`);
    process.exit(1);
  }
}
