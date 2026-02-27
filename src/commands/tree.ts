/**
 * Tree Command - Visualize monorepo structure
 *
 * Exposes the tree scanner as a CLI command with human-readable
 * and JSON output modes for tool consumption.
 */

import { scanTree, readPackageJson } from "../core/tree.js";
import type { MonorepoModule, MonorepoTree } from "../types.js";

/**
 * Options for the tree command
 */
export interface TreeCommandOptions {
  /** JSON output for tool consumption */
  json?: boolean;
  /** Max scan depth */
  depth?: number;
}

/**
 * CLI handler for the `dev-link tree` command.
 *
 * Scans the monorepo from the current directory and prints either
 * a visual tree or JSON representation of the structure.
 *
 * @param options - Command options (json, depth)
 */
export async function handleTree(options: TreeCommandOptions): Promise<void> {
  try {
    const tree = await scanTree(process.cwd(), { maxDepth: options.depth });

    if (options.json) {
      console.log(JSON.stringify(tree, null, 2));
    } else {
      await printVisualTree(tree);
    }
  } catch (error: any) {
    if (options.json) {
      console.error(JSON.stringify({ error: error.message }));
    } else {
      console.error(`✗ ${error.message}`);
    }
    process.exit(1);
  }
}

// ============================================================================
// Visual Output
// ============================================================================

/**
 * Print a human-readable visual tree to stdout.
 */
async function printVisualTree(tree: MonorepoTree): Promise<void> {
  const rootPkg = await readPackageJson(tree.root);
  const rootName = rootPkg?.name ?? "unknown";

  console.log(`📂 Monorepo: ${rootName}`);

  // Compute column widths for alignment
  const allEntries = collectEntries(tree.modules);
  const maxNameLen = Math.max(...allEntries.map((e) => e.displayName.length));
  const maxTypeLen = Math.max(...allEntries.map((e) => e.displayType.length));

  // Print each top-level module
  const total = tree.modules.length;
  for (let i = 0; i < total; i++) {
    const mod = tree.modules[i];
    const isLast = i === total - 1;
    printModule(mod, "", isLast, maxNameLen, maxTypeLen);
  }

  // Summary
  console.log("");
  const subMonorepoCount = tree.installLevels.length - 1;
  console.log(
    `Install Levels: ${tree.installLevels.length} (1 root + ${subMonorepoCount} sub-monorepo${subMonorepoCount !== 1 ? "s" : ""})`,
  );

  if (tree.isolatedPackages.length > 0) {
    const relativePaths = tree.isolatedPackages.map((absPath) => {
      const rel = absPath.substring(tree.root.length + 1);
      return rel;
    });
    console.log(
      `Isolated Packages: ${tree.isolatedPackages.length} (${relativePaths.join(", ")})`,
    );
  } else {
    console.log("Isolated Packages: 0");
  }
}

/**
 * Print a single module line with tree characters and aligned columns.
 */
function printModule(
  mod: MonorepoModule,
  prefix: string,
  isLast: boolean,
  maxNameLen: number,
  maxTypeLen: number,
): void {
  const connector = isLast ? "└── " : "├── ";
  const displayType = mod.isIsolated ? `${mod.type} (isolated)` : mod.type;
  const paddedName = mod.name.padEnd(maxNameLen);
  const paddedType = displayType.padEnd(maxTypeLen);

  console.log(`${prefix}${connector}${paddedName} ${paddedType} ${mod.relativePath}`);

  // Print children
  const childPrefix = prefix + (isLast ? "    " : "│   ");
  const childCount = mod.children.length;
  for (let i = 0; i < childCount; i++) {
    const child = mod.children[i];
    const childIsLast = i === childCount - 1;
    printModule(child, childPrefix, childIsLast, maxNameLen, maxTypeLen);
  }
}

// ============================================================================
// Helpers
// ============================================================================

interface EntryInfo {
  displayName: string;
  displayType: string;
}

/**
 * Collect all entries (modules + children) for column width calculation.
 */
function collectEntries(modules: MonorepoModule[]): EntryInfo[] {
  const entries: EntryInfo[] = [];
  for (const mod of modules) {
    entries.push({
      displayName: mod.name,
      displayType: mod.isIsolated ? `${mod.type} (isolated)` : mod.type,
    });
    for (const child of mod.children) {
      entries.push({
        displayName: child.name,
        displayType: child.isIsolated
          ? `${child.type} (isolated)`
          : child.type,
      });
    }
  }
  return entries;
}
