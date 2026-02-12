/**
 * Verify Command - Verificar integridad del store
 */

import { withStoreLock } from "../core/lock.js";
import {
  readRegistry,
  writeRegistry,
  getNamespacesFromRegistry,
  getPackagesInNamespace,
  getVersionsInNamespace,
  removePackageFromRegistry,
  addPackageToRegistry,
} from "../core/registry.js";
import {
  listNamespaces,
  listPackagesInNamespace,
  listVersionsInNamespace,
  packageVersionExists,
  readPackageSignature,
  findOrphanedPackages,
  deletePackageVersion,
} from "../core/store.js";
import type { VersionEntry } from "../types.js";

export interface VerifyResult {
  orphansInRegistry: { namespace: string; package: string; version: string }[];
  orphansOnDisk: { namespace: string; package: string; version: string }[];
  signatureMismatches: { namespace: string; package: string; version: string }[];
  fixed: boolean;
}

/**
 * Verify store integrity
 */
export async function verifyStore(fix: boolean = false): Promise<VerifyResult> {
  const result: VerifyResult = {
    orphansInRegistry: [],
    orphansOnDisk: [],
    signatureMismatches: [],
    fixed: false,
  };
  
  const registry = await readRegistry();
  
  // Check for orphans in registry (entries without files on disk)
  const registryNamespaces = getNamespacesFromRegistry(registry);
  
  for (const ns of registryNamespaces) {
    const packages = getPackagesInNamespace(registry, ns);
    
    for (const pkg of packages) {
      const versions = getVersionsInNamespace(registry, ns, pkg);
      
      for (const version of versions) {
        const exists = await packageVersionExists(ns, pkg, version);
        if (!exists) {
          result.orphansInRegistry.push({ namespace: ns, package: pkg, version });
        } else {
          // Check signature
          const diskSig = await readPackageSignature(ns, pkg, version);
          const regEntry = registry.namespaces[ns]?.packages[pkg]?.versions[version];
          if (diskSig && regEntry && diskSig !== regEntry.signature) {
            result.signatureMismatches.push({ namespace: ns, package: pkg, version });
          }
        }
      }
    }
  }
  
  // Check for orphans on disk (files without registry entries)
  const diskNamespaces = await listNamespaces();
  
  for (const ns of diskNamespaces) {
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
      result.orphansOnDisk.push({
        namespace: ns,
        package: orphan.packageName,
        version: orphan.version,
      });
    }
  }
  
  // Fix issues if requested
  if (fix && (result.orphansInRegistry.length > 0 || result.orphansOnDisk.length > 0)) {
    await withStoreLock(async () => {
      const registry = await readRegistry();
      
      // Remove orphans from registry
      for (const orphan of result.orphansInRegistry) {
        removePackageFromRegistry(registry, orphan.namespace, orphan.package, orphan.version);
      }
      
      // Remove orphans from disk
      for (const orphan of result.orphansOnDisk) {
        await deletePackageVersion(orphan.namespace, orphan.package, orphan.version);
      }
      
      await writeRegistry(registry);
      result.fixed = true;
    });
  }
  
  return result;
}

/**
 * CLI handler for verify command
 */
export async function handleVerify(args: { fix?: boolean }): Promise<void> {
  try {
    console.log("🔍 Verifying store integrity...\n");
    
    const result = await verifyStore(args.fix);
    
    let hasIssues = false;
    
    if (result.orphansInRegistry.length > 0) {
      hasIssues = true;
      console.log(`⚠️  Registry entries without files (${result.orphansInRegistry.length}):`);
      for (const o of result.orphansInRegistry) {
        console.log(`  - ${o.namespace}/${o.package}@${o.version}`);
      }
      console.log();
    }
    
    if (result.orphansOnDisk.length > 0) {
      hasIssues = true;
      console.log(`⚠️  Files without registry entries (${result.orphansOnDisk.length}):`);
      for (const o of result.orphansOnDisk) {
        console.log(`  - ${o.namespace}/${o.package}@${o.version}`);
      }
      console.log();
    }
    
    if (result.signatureMismatches.length > 0) {
      hasIssues = true;
      console.log(`⚠️  Signature mismatches (${result.signatureMismatches.length}):`);
      for (const o of result.signatureMismatches) {
        console.log(`  - ${o.namespace}/${o.package}@${o.version}`);
      }
      console.log();
    }
    
    if (result.fixed) {
      console.log("✓ Issues fixed");
    } else if (hasIssues && !args.fix) {
      console.log("Run with --fix to repair issues");
      process.exit(5);
    } else if (!hasIssues) {
      console.log("✓ Store is healthy");
    }
  } catch (error: any) {
    console.error(`✗ Verify failed: ${error.message}`);
    process.exit(1);
  }
}
