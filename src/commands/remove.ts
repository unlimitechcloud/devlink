/**
 * Remove Command - Eliminar paquetes del store
 */

import { withStoreLock } from "../core/lock.js";
import {
  readRegistry,
  writeRegistry,
  removePackageFromRegistry,
  removeNamespaceFromRegistry,
  getPackageFromRegistry,
  namespaceExistsInRegistry,
} from "../core/registry.js";
import {
  deletePackageVersion,
  deletePackage,
  deleteNamespace,
  namespaceExists,
} from "../core/store.js";
import { parsePackageSpec } from "../core/resolver.js";
import { DEFAULT_NAMESPACE } from "../constants.js";
import { createOutputRouter } from "../pipeline/output-router.js";

export interface RemoveOptions {
  namespace?: string;
}

export interface RemoveResult {
  type: "version" | "package" | "namespace";
  name: string;
  version?: string;
  namespace?: string;
}

/**
 * Remove a package version, package, or namespace
 */
export async function removeFromStore(
  target: string,
  options: RemoveOptions = {}
): Promise<RemoveResult> {
  const namespace = options.namespace || DEFAULT_NAMESPACE;
  
  return withStoreLock(async () => {
    const registry = await readRegistry();
    
    // Check if target is a namespace
    if (!target.includes("@") && !target.includes("/")) {
      // Could be a namespace or a simple package name
      if (namespaceExistsInRegistry(registry, target) && !options.namespace) {
        // It's a namespace - remove it
        if (target === DEFAULT_NAMESPACE) {
          throw new Error(`Cannot delete reserved namespace '${DEFAULT_NAMESPACE}'`);
        }
        
        removeNamespaceFromRegistry(registry, target);
        await deleteNamespace(target);
        await writeRegistry(registry);
        
        return { type: "namespace", name: target };
      }
    }
    
    // Parse as package spec
    const parsed = parsePackageSpec(target);
    
    if (parsed) {
      // Remove specific version
      const { name, version } = parsed;
      
      const pkgEntry = getPackageFromRegistry(registry, namespace, name);
      if (!pkgEntry || !pkgEntry.versions[version]) {
        throw new Error(`Package ${name}@${version} not found in namespace '${namespace}'`);
      }
      
      removePackageFromRegistry(registry, namespace, name, version);
      await deletePackageVersion(namespace, name, version);
      await writeRegistry(registry);
      
      return { type: "version", name, version, namespace };
    }
    
    // Remove entire package
    const pkgEntry = getPackageFromRegistry(registry, namespace, target);
    if (!pkgEntry) {
      throw new Error(`Package ${target} not found in namespace '${namespace}'`);
    }
    
    removePackageFromRegistry(registry, namespace, target);
    await deletePackage(namespace, target);
    await writeRegistry(registry);
    
    return { type: "package", name: target, namespace };
  });
}

/**
 * CLI handler for remove command
 */
export async function handleRemove(args: {
  target: string;
  namespace?: string;
  json?: boolean;
}): Promise<void> {
  const router = createOutputRouter(!!args.json);

  try {
    // Read registry before removal to compute remaining versions
    const registryBefore = await readRegistry();
    const result = await removeFromStore(args.target, {
      namespace: args.namespace,
    });

    if (args.json) {
      // Compute remaining versions for the package after removal
      let remainingVersions = 0;
      if (result.type === "version" && result.namespace) {
        const pkgEntry = getPackageFromRegistry(registryBefore, result.namespace, result.name);
        if (pkgEntry) {
          // Subtract 1 for the version we just removed
          remainingVersions = Object.keys(pkgEntry.versions).length - 1;
        }
      }

      router.json({
        target: args.target,
        removed: [{
          name: result.name,
          version: result.version || "*",
          namespace: result.namespace || result.name,
        }],
        remainingVersions,
      });
    } else {
      switch (result.type) {
        case "namespace":
          router.human(`✓ Removed namespace '${result.name}'`);
          break;
        case "package":
          router.human(`✓ Removed package '${result.name}' from namespace '${result.namespace}'`);
          break;
        case "version":
          router.human(`✓ Removed ${result.name}@${result.version} from namespace '${result.namespace}'`);
          break;
      }
    }
  } catch (error: any) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ error: error.message }) + "\n");
    } else {
      console.error(`✗ Remove failed: ${error.message}`);
    }
    process.exit(1);
  }
}
