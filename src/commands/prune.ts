/**
 * Prune Command - Eliminar paquetes huérfanos del disco
 */

import { withStoreLock } from "../core/lock.js";
import { readRegistry, writeRegistry } from "../core/registry.js";
import {
  listNamespaces,
  findOrphanedPackages,
  deletePackageVersion,
} from "../core/store.js";
import { getPackagePath } from "../constants.js";
import { createOutputRouter } from "../pipeline/output-router.js";

export interface PruneOptions {
  namespace?: string;
  dryRun?: boolean;
}

export interface PruneResult {
  removed: { namespace: string; package: string; version: string }[];
  dryRun: boolean;
}

/**
 * Prune orphaned packages from disk
 */
export async function pruneStore(options: PruneOptions = {}): Promise<PruneResult> {
  const result: PruneResult = {
    removed: [],
    dryRun: options.dryRun || false,
  };
  
  const registry = await readRegistry();
  const namespaces = options.namespace
    ? [options.namespace]
    : await listNamespaces();
  
  // Find all orphans
  for (const ns of namespaces) {
    const registeredPackages = new Set<string>();
    const nsEntry = registry.namespaces[ns];
    
    if (nsEntry) {
      for (const [pkg, pkgEntry] of Object.entries(nsEntry.packages)) {
        for (const version of Object.keys(pkgEntry.versions)) {
          registeredPackages.add(`${pkg}@${version}`);
        }
      }
    }
    
    const orphans = await findOrphanedPackages(ns, registeredPackages);
    for (const orphan of orphans) {
      result.removed.push({
        namespace: ns,
        package: orphan.packageName,
        version: orphan.version,
      });
    }
  }
  
  // Remove orphans if not dry run
  if (!options.dryRun && result.removed.length > 0) {
    await withStoreLock(async () => {
      for (const orphan of result.removed) {
        await deletePackageVersion(orphan.namespace, orphan.package, orphan.version);
      }
    });
  }
  
  return result;
}

/**
 * CLI handler for prune command
 */
export async function handlePrune(args: {
  namespace?: string;
  dryRun?: boolean;
  json?: boolean;
}): Promise<void> {
  const router = createOutputRouter(!!args.json);

  try {
    const result = await pruneStore(args);

    if (args.json) {
      router.json({
        pruned: result.removed.map(r => ({
          namespace: r.namespace,
          name: r.package,
          version: r.version,
          path: getPackagePath(r.namespace, r.package, r.version),
        })),
        dryRun: result.dryRun,
      });
    } else {
      if (result.removed.length === 0) {
        router.human("✓ No orphaned packages found");
        return;
      }
      
      if (result.dryRun) {
        router.human(`🔍 Would remove ${result.removed.length} orphaned package(s):`);
      } else {
        router.human(`🧹 Removed ${result.removed.length} orphaned package(s):`);
      }
      
      for (const r of result.removed) {
        router.human(`  - ${r.namespace}/${r.package}@${r.version}`);
      }
    }
  } catch (error: any) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ error: error.message }) + "\n");
    } else {
      console.error(`✗ Prune failed: ${error.message}`);
    }
    process.exit(1);
  }
}
