/**
 * List Command - Listar paquetes en el store
 */

import { readRegistry } from "../core/registry.js";
import { formatByNamespaceTree, formatByPackageTree } from "../formatters/tree.js";
import { formatByNamespaceFlat, formatByPackageFlat } from "../formatters/flat.js";
import { createOutputRouter } from "../pipeline/output-router.js";
import type { Registry } from "../types.js";

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
 * Filter registry data by namespace and package filters for JSON output
 */
function filterRegistryForJson(
  registry: Registry,
  namespaces?: string[],
  packages?: string[]
): Record<string, any> {
  const result: Record<string, any> = {};

  const nsKeys = namespaces && namespaces.length > 0
    ? namespaces.filter(ns => registry.namespaces[ns])
    : Object.keys(registry.namespaces);

  for (const ns of nsKeys) {
    const nsEntry = registry.namespaces[ns];
    if (!nsEntry) continue;

    const pkgKeys = packages && packages.length > 0
      ? packages.filter(pkg => nsEntry.packages[pkg])
      : Object.keys(nsEntry.packages);

    const pkgsOut: Record<string, any> = {};
    for (const pkg of pkgKeys) {
      const pkgEntry = nsEntry.packages[pkg];
      if (!pkgEntry) continue;

      const versionsOut: Record<string, any> = {};
      for (const [ver, verEntry] of Object.entries(pkgEntry.versions)) {
        versionsOut[ver] = {
          signature: verEntry.signature,
          published: verEntry.published,
          files: verEntry.files,
        };
      }
      pkgsOut[pkg] = { versions: versionsOut };
    }

    if (Object.keys(pkgsOut).length > 0) {
      result[ns] = { packages: pkgsOut };
    }
  }

  return result;
}

/**
 * CLI handler for list command
 */
export async function handleList(args: {
  namespaces?: string[];
  packages?: string[];
  flat?: boolean;
  json?: boolean;
}): Promise<void> {
  const router = createOutputRouter(!!args.json);

  try {
    if (args.json) {
      const registry = await readRegistry();
      const filtered = filterRegistryForJson(registry, args.namespaces, args.packages);
      router.json({ namespaces: filtered });
    } else {
      const byPackage = args.packages && args.packages.length > 0;
      const output = await listPackages({
        namespaces: args.namespaces,
        packages: args.packages,
        flat: args.flat,
        byPackage,
      });
      router.human(output);
    }
  } catch (error: any) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ error: error.message }) + "\n");
    } else {
      console.error(`✗ List failed: ${error.message}`);
    }
    process.exit(1);
  }
}
