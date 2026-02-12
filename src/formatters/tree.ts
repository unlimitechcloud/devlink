/**
 * Tree Formatter - Formateo en árbol para output
 */

import type { Registry } from "../types.js";
import { DEFAULT_NAMESPACE } from "../constants.js";

export interface TreeOptions {
  showSignature?: boolean;
  showDate?: boolean;
  showFiles?: boolean;
}

const DEFAULT_OPTIONS: TreeOptions = {
  showSignature: true,
  showDate: false,
  showFiles: false,
};

/**
 * Group packages by scope
 */
function groupByScope(packages: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  
  for (const pkg of packages) {
    if (pkg.startsWith("@")) {
      const [scope, name] = pkg.split("/");
      if (!groups.has(scope)) {
        groups.set(scope, []);
      }
      groups.get(scope)!.push(name);
    } else {
      if (!groups.has("")) {
        groups.set("", []);
      }
      groups.get("")!.push(pkg);
    }
  }
  
  return groups;
}

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
 * Format registry by namespace (tree view)
 */
export function formatByNamespaceTree(
  registry: Registry,
  filter?: string[],
  options: TreeOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = ["📦 DevLink Store", ""];
  
  const namespaces = sortNamespaces(Object.keys(registry.namespaces));
  const filteredNs = filter ? namespaces.filter(ns => filter.includes(ns)) : namespaces;
  
  for (let nsIdx = 0; nsIdx < filteredNs.length; nsIdx++) {
    const ns = filteredNs[nsIdx];
    const nsEntry = registry.namespaces[ns];
    const isLastNs = nsIdx === filteredNs.length - 1;
    const nsPrefix = isLastNs ? "└── " : "├── ";
    const childPrefix = isLastNs ? "    " : "│   ";
    
    lines.push(`${nsPrefix}${ns}/`);
    
    const packages = Object.keys(nsEntry.packages).sort();
    const byScope = groupByScope(packages);
    const scopes = Array.from(byScope.keys()).sort();
    
    for (let scopeIdx = 0; scopeIdx < scopes.length; scopeIdx++) {
      const scope = scopes[scopeIdx];
      const pkgNames = byScope.get(scope)!.sort();
      const isLastScope = scopeIdx === scopes.length - 1;
      
      if (scope) {
        // Scoped packages
        const scopePrefix = isLastScope ? "└── " : "├── ";
        const scopeChildPrefix = isLastScope ? "    " : "│   ";
        
        lines.push(`${childPrefix}${scopePrefix}${scope}/`);
        
        for (let pkgIdx = 0; pkgIdx < pkgNames.length; pkgIdx++) {
          const pkgName = pkgNames[pkgIdx];
          const fullPkgName = `${scope}/${pkgName}`;
          const pkgEntry = nsEntry.packages[fullPkgName];
          const versions = Object.keys(pkgEntry.versions).sort();
          const isLastPkg = pkgIdx === pkgNames.length - 1;
          const pkgPrefix = isLastPkg ? "└── " : "├── ";
          const versionPrefix = isLastPkg ? "    " : "│   ";
          
          lines.push(`${childPrefix}${scopeChildPrefix}${pkgPrefix}${pkgName}/`);
          
          for (let verIdx = 0; verIdx < versions.length; verIdx++) {
            const version = versions[verIdx];
            const verEntry = pkgEntry.versions[version];
            const isLastVer = verIdx === versions.length - 1;
            const verPfx = isLastVer ? "└── " : "├── ";
            
            let verLine = `${childPrefix}${scopeChildPrefix}${versionPrefix}${verPfx}${version}`;
            if (opts.showSignature) {
              verLine += `  (${verEntry.signature.slice(0, 8)})`;
            }
            lines.push(verLine);
          }
        }
      } else {
        // Non-scoped packages
        for (let pkgIdx = 0; pkgIdx < pkgNames.length; pkgIdx++) {
          const pkgName = pkgNames[pkgIdx];
          const pkgEntry = nsEntry.packages[pkgName];
          const versions = Object.keys(pkgEntry.versions).sort();
          const isLastPkg = pkgIdx === pkgNames.length - 1 && isLastScope;
          const pkgPrefix = isLastPkg ? "└── " : "├── ";
          const versionPrefix = isLastPkg ? "    " : "│   ";
          
          lines.push(`${childPrefix}${pkgPrefix}${pkgName}/`);
          
          for (let verIdx = 0; verIdx < versions.length; verIdx++) {
            const version = versions[verIdx];
            const verEntry = pkgEntry.versions[version];
            const isLastVer = verIdx === versions.length - 1;
            const verPfx = isLastVer ? "└── " : "├── ";
            
            let verLine = `${childPrefix}${versionPrefix}${verPfx}${version}`;
            if (opts.showSignature) {
              verLine += `  (${verEntry.signature.slice(0, 8)})`;
            }
            lines.push(verLine);
          }
        }
      }
    }
  }
  
  return lines.join("\n");
}


/**
 * Invert registry structure: package → namespace → versions
 */
function invertRegistry(registry: Registry): Map<string, Map<string, string[]>> {
  const result = new Map<string, Map<string, string[]>>();
  
  for (const [ns, nsEntry] of Object.entries(registry.namespaces)) {
    for (const [pkgName, pkgEntry] of Object.entries(nsEntry.packages)) {
      if (!result.has(pkgName)) {
        result.set(pkgName, new Map());
      }
      const versions = Object.keys(pkgEntry.versions).sort();
      result.get(pkgName)!.set(ns, versions);
    }
  }
  
  return result;
}

/**
 * Format registry by package (tree view)
 */
export function formatByPackageTree(
  registry: Registry,
  filter?: string[],
  options: TreeOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = ["📦 DevLink Store (by package)", ""];
  
  const byPackage = invertRegistry(registry);
  let packages = Array.from(byPackage.keys()).sort();
  
  // Apply filter
  if (filter && filter.length > 0) {
    packages = packages.filter(pkg => {
      for (const f of filter) {
        if (f.startsWith("@") && !f.includes("/")) {
          // Scope filter
          if (pkg.startsWith(f + "/") || pkg === f) return true;
        } else {
          // Exact match
          if (pkg === f) return true;
        }
      }
      return false;
    });
  }
  
  const byScope = groupByScope(packages);
  const scopes = Array.from(byScope.keys()).sort();
  
  for (let scopeIdx = 0; scopeIdx < scopes.length; scopeIdx++) {
    const scope = scopes[scopeIdx];
    const pkgNames = byScope.get(scope)!.sort();
    const isLastScope = scopeIdx === scopes.length - 1;
    
    if (scope) {
      const scopePrefix = isLastScope ? "└── " : "├── ";
      const scopeChildPrefix = isLastScope ? "    " : "│   ";
      
      lines.push(`${scopePrefix}${scope}/`);
      
      for (let pkgIdx = 0; pkgIdx < pkgNames.length; pkgIdx++) {
        const pkgName = pkgNames[pkgIdx];
        const fullPkgName = `${scope}/${pkgName}`;
        const namespaces = byPackage.get(fullPkgName)!;
        const isLastPkg = pkgIdx === pkgNames.length - 1;
        const pkgPrefix = isLastPkg ? "└── " : "├── ";
        const nsChildPrefix = isLastPkg ? "    " : "│   ";
        
        lines.push(`${scopeChildPrefix}${pkgPrefix}${pkgName}/`);
        
        const sortedNs = sortNamespaces(Array.from(namespaces.keys()));
        for (let nsIdx = 0; nsIdx < sortedNs.length; nsIdx++) {
          const ns = sortedNs[nsIdx];
          const versions = namespaces.get(ns)!;
          const isLastNs = nsIdx === sortedNs.length - 1;
          const nsPrefix = isLastNs ? "└── " : "├── ";
          const verChildPrefix = isLastNs ? "    " : "│   ";
          
          lines.push(`${scopeChildPrefix}${nsChildPrefix}${nsPrefix}${ns}/`);
          
          for (let verIdx = 0; verIdx < versions.length; verIdx++) {
            const version = versions[verIdx];
            const isLastVer = verIdx === versions.length - 1;
            const verPrefix = isLastVer ? "└── " : "├── ";
            
            const verEntry = registry.namespaces[ns].packages[fullPkgName].versions[version];
            let verLine = `${scopeChildPrefix}${nsChildPrefix}${verChildPrefix}${verPrefix}${version}`;
            if (opts.showSignature) {
              verLine += `  (${verEntry.signature.slice(0, 8)})`;
            }
            lines.push(verLine);
          }
        }
      }
    } else {
      // Non-scoped packages
      for (let pkgIdx = 0; pkgIdx < pkgNames.length; pkgIdx++) {
        const pkgName = pkgNames[pkgIdx];
        const namespaces = byPackage.get(pkgName)!;
        const isLastPkg = pkgIdx === pkgNames.length - 1 && isLastScope;
        const pkgPrefix = isLastPkg ? "└── " : "├── ";
        const nsChildPrefix = isLastPkg ? "    " : "│   ";
        
        lines.push(`${pkgPrefix}${pkgName}/`);
        
        const sortedNs = sortNamespaces(Array.from(namespaces.keys()));
        for (let nsIdx = 0; nsIdx < sortedNs.length; nsIdx++) {
          const ns = sortedNs[nsIdx];
          const versions = namespaces.get(ns)!;
          const isLastNs = nsIdx === sortedNs.length - 1;
          const nsPrefix = isLastNs ? "└── " : "├── ";
          const verChildPrefix = isLastNs ? "    " : "│   ";
          
          lines.push(`${nsChildPrefix}${nsPrefix}${ns}/`);
          
          for (let verIdx = 0; verIdx < versions.length; verIdx++) {
            const version = versions[verIdx];
            const isLastVer = verIdx === versions.length - 1;
            const verPrefix = isLastVer ? "└── " : "├── ";
            
            const verEntry = registry.namespaces[ns].packages[pkgName].versions[version];
            let verLine = `${nsChildPrefix}${verChildPrefix}${verPrefix}${version}`;
            if (opts.showSignature) {
              verLine += `  (${verEntry.signature.slice(0, 8)})`;
            }
            lines.push(verLine);
          }
        }
      }
    }
  }
  
  return lines.join("\n");
}

/**
 * Format consumers tree
 */
export function formatConsumersTree(
  consumers: { projectPath: string; packages: { name: string; version: string; namespace: string }[] }[]
): string {
  const lines: string[] = ["👥 Consumers", ""];
  
  for (let i = 0; i < consumers.length; i++) {
    const consumer = consumers[i];
    const isLast = i === consumers.length - 1;
    const prefix = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";
    
    lines.push(`${prefix}${consumer.projectPath}`);
    
    for (let j = 0; j < consumer.packages.length; j++) {
      const pkg = consumer.packages[j];
      const isLastPkg = j === consumer.packages.length - 1;
      const pkgPrefix = isLastPkg ? "└── " : "├── ";
      
      lines.push(`${childPrefix}${pkgPrefix}${pkg.name}@${pkg.version} (${pkg.namespace})`);
    }
  }
  
  return lines.join("\n");
}
