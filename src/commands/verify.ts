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
import { createOutputRouter } from "../pipeline/output-router.js";

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
export async function handleVerify(args: { fix?: boolean; json?: boolean }): Promise<void> {
  const router = createOutputRouter(!!args.json);

  try {
    router.human("🔍 Verifying store integrity...\n");
    
    const result = await verifyStore(args.fix);

    if (args.json) {
      const issues: { type: string; namespace: string; package: string; version: string }[] = [];

      for (const o of result.orphansInRegistry) {
        issues.push({ type: "orphan-registry", namespace: o.namespace, package: o.package, version: o.version });
      }
      for (const o of result.orphansOnDisk) {
        issues.push({ type: "orphan-disk", namespace: o.namespace, package: o.package, version: o.version });
      }
      for (const o of result.signatureMismatches) {
        issues.push({ type: "signature-mismatch", namespace: o.namespace, package: o.package, version: o.version });
      }

      const jsonOutput: any = {
        valid: issues.length === 0,
        issues,
      };

      if (result.fixed) {
        jsonOutput.fixed = issues;
      }

      router.json(jsonOutput);

      if (issues.length > 0 && !args.fix) {
        process.exit(5);
      }
    } else {
      let hasIssues = false;
      
      if (result.orphansInRegistry.length > 0) {
        hasIssues = true;
        router.human(`⚠️  Registry entries without files (${result.orphansInRegistry.length}):`);
        for (const o of result.orphansInRegistry) {
          router.human(`  - ${o.namespace}/${o.package}@${o.version}`);
        }
        router.human("");
      }
      
      if (result.orphansOnDisk.length > 0) {
        hasIssues = true;
        router.human(`⚠️  Files without registry entries (${result.orphansOnDisk.length}):`);
        for (const o of result.orphansOnDisk) {
          router.human(`  - ${o.namespace}/${o.package}@${o.version}`);
        }
        router.human("");
      }
      
      if (result.signatureMismatches.length > 0) {
        hasIssues = true;
        router.human(`⚠️  Signature mismatches (${result.signatureMismatches.length}):`);
        for (const o of result.signatureMismatches) {
          router.human(`  - ${o.namespace}/${o.package}@${o.version}`);
        }
        router.human("");
      }
      
      if (result.fixed) {
        router.human("✓ Issues fixed");
      } else if (hasIssues && !args.fix) {
        router.human("Run with --fix to repair issues");
        process.exit(5);
      } else if (!hasIssues) {
        router.human("✓ Store is healthy");
      }
    }
  } catch (error: any) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ error: error.message }) + "\n");
    } else {
      console.error(`✗ Verify failed: ${error.message}`);
    }
    process.exit(1);
  }
}
