/**
 * Flat Formatter - Formateo plano para output
 */

import type { Registry } from "../types.js";
import { DEFAULT_NAMESPACE } from "../constants.js";

export interface FlatOptions {
  showSignature?: boolean;
  separator?: string;
}

const DEFAULT_OPTIONS: FlatOptions = {
  showSignature: true,
  separator: "  ",
};

/**
 * Sort namespaces with global first
 */
function sortNamespaces(namespaces: string[]): string[] {
  return [...namespaces].sort((a, b) => {
    if (a === DEFAULT_NAMESPACE) return -1;
    if (b === DEFAULT_NAMESPACE) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Format registry by namespace (flat view)
 * Output: namespace  package@version  (signature)
 */
export function formatByNamespaceFlat(
  registry: Registry,
  filter?: string[],
  options: FlatOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];
  
  const namespaces = sortNamespaces(Object.keys(registry.namespaces));
  const filteredNs = filter ? namespaces.filter(ns => filter.includes(ns)) : namespaces;
  
  for (const ns of filteredNs) {
    const nsEntry = registry.namespaces[ns];
    const packages = Object.keys(nsEntry.packages).sort();
    
    for (const pkgName of packages) {
      const pkgEntry = nsEntry.packages[pkgName];
      const versions = Object.keys(pkgEntry.versions).sort();
      
      for (const version of versions) {
        const verEntry = pkgEntry.versions[version];
        let line = `${ns}${opts.separator}${pkgName}@${version}`;
        if (opts.showSignature) {
          line += `${opts.separator}(${verEntry.signature.slice(0, 8)})`;
        }
        lines.push(line);
      }
    }
  }
  
  return lines.join("\n");
}

/**
 * Format registry by package (flat view)
 * Output: package@version  namespace  (signature)
 */
export function formatByPackageFlat(
  registry: Registry,
  filter?: string[],
  options: FlatOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const entries: { pkg: string; version: string; ns: string; sig: string }[] = [];
  
  for (const [ns, nsEntry] of Object.entries(registry.namespaces)) {
    for (const [pkgName, pkgEntry] of Object.entries(nsEntry.packages)) {
      // Apply filter
      if (filter && filter.length > 0) {
        const matches = filter.some(f => {
          if (f.startsWith("@") && !f.includes("/")) {
            return pkgName.startsWith(f + "/") || pkgName === f;
          }
          return pkgName === f;
        });
        if (!matches) continue;
      }
      
      for (const [version, verEntry] of Object.entries(pkgEntry.versions)) {
        entries.push({
          pkg: pkgName,
          version,
          ns,
          sig: verEntry.signature,
        });
      }
    }
  }
  
  // Sort by package name, then version, then namespace
  entries.sort((a, b) => {
    const pkgCmp = a.pkg.localeCompare(b.pkg);
    if (pkgCmp !== 0) return pkgCmp;
    const verCmp = a.version.localeCompare(b.version);
    if (verCmp !== 0) return verCmp;
    if (a.ns === DEFAULT_NAMESPACE) return -1;
    if (b.ns === DEFAULT_NAMESPACE) return 1;
    return a.ns.localeCompare(b.ns);
  });
  
  const lines: string[] = [];
  for (const entry of entries) {
    let line = `${entry.pkg}@${entry.version}${opts.separator}${entry.ns}`;
    if (opts.showSignature) {
      line += `${opts.separator}(${entry.sig.slice(0, 8)})`;
    }
    lines.push(line);
  }
  
  return lines.join("\n");
}

/**
 * Format consumers flat
 * Output: project_path  package@version  namespace
 */
export function formatConsumersFlat(
  consumers: { projectPath: string; packages: { name: string; version: string; namespace: string }[] }[],
  options: FlatOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];
  
  for (const consumer of consumers) {
    for (const pkg of consumer.packages) {
      lines.push(
        `${consumer.projectPath}${opts.separator}${pkg.name}@${pkg.version}${opts.separator}${pkg.namespace}`
      );
    }
  }
  
  return lines.join("\n");
}

/**
 * Format resolution results flat
 */
export function formatResolutionFlat(
  results: { package: string; version: string; found: boolean; namespace?: string; signature?: string }[]
): string {
  const lines: string[] = [];
  
  for (const result of results) {
    if (result.found) {
      lines.push(`${result.package}@${result.version}  ${result.namespace}  (${result.signature?.slice(0, 8)})`);
    } else {
      lines.push(`${result.package}@${result.version}  NOT_FOUND`);
    }
  }
  
  return lines.join("\n");
}
