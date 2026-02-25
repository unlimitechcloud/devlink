/**
 * Docs Command - Display embedded documentation
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Documentation structure
export interface DocEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: DocEntry[];
}

/**
 * Get the docs directory path (relative to package root)
 */
export function getDocsPath(): string {
  // From dist/commands/docs.js, go up to package root
  return path.resolve(__dirname, "../../docs");
}

/**
 * Normalize a path for comparison (lowercase, no .md extension)
 */
export function normalizePath(p: string): string {
  return p.toLowerCase().replace(/\.md$/, "").replace(/\\/g, "/");
}

/**
 * Build documentation tree from filesystem
 */
export function buildDocTree(dirPath: string, relativePath: string = "", isRoot: boolean = true): DocEntry[] {
  const entries: DocEntry[] = [];
  
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      if (item.name.startsWith(".")) continue;
      
      const itemPath = path.join(dirPath, item.name);
      const relPath = relativePath ? `${relativePath}/${item.name}` : item.name;
      
      if (item.isDirectory()) {
        entries.push({
          name: item.name,
          path: relPath,
          type: "directory",
          children: buildDocTree(itemPath, relPath, false),
        });
      } else if (!isRoot && item.name.endsWith(".md") && item.name !== "AGENTS.md") {
        // Regular docs — exclude AGENTS.md (injected as virtual entry)
        // At root level, skip loose files (only section directories are shown)
        entries.push({
          name: item.name.replace(/\.md$/, ""),
          path: relPath.replace(/\.md$/, ""),
          type: "file",
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  
  return entries.sort((a, b) => {
    // Directories first, then files
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Find a document by path (case insensitive)
 */
export function findDocument(
  tree: DocEntry[],
  searchPath: string
): { entry: DocEntry; fullPath: string } | null {
  const normalized = normalizePath(searchPath);
  const parts = normalized.split("/").filter(Boolean);
  
  let current = tree;
  let currentPath = "";
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    
    const found = current.find(
      (e) => normalizePath(e.name) === part
    );
    
    if (!found) return null;
    
    currentPath = currentPath ? `${currentPath}/${found.name}` : found.name;
    
    if (isLast) {
      return { entry: found, fullPath: currentPath };
    }
    
    if (found.type === "directory" && found.children) {
      current = found.children;
    } else {
      return null;
    }
  }
  
  return null;
}

/**
 * Format the documentation tree for display
 */
export function formatTree(entries: DocEntry[], prefix: string = ""): string {
  const lines: string[] = [];
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";
    
    if (entry.type === "directory") {
      lines.push(`${prefix}${connector}${entry.name}/`);
      if (entry.children && entry.children.length > 0) {
        lines.push(formatTree(entry.children, prefix + childPrefix));
      }
    } else {
      lines.push(`${prefix}${connector}${entry.name}.md`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Format directory listing
 */
export function formatDirectoryListing(entry: DocEntry): string {
  const lines: string[] = [];
  lines.push(`📁 ${entry.path}/\n`);
  
  if (entry.children && entry.children.length > 0) {
    lines.push("Documents:");
    for (const child of entry.children) {
      if (child.type === "file") {
        lines.push(`  ${child.name}.md`);
      } else {
        lines.push(`  ${child.name}/`);
      }
    }
    lines.push("");
    lines.push(`Usage: devlink docs ${entry.path}/<document>`);
  } else {
    lines.push("(empty directory)");
  }
  
  return lines.join("\n");
}

/**
 * Read and return document content
 */
export function readDocument(docPath: string, docsDir?: string): string | null {
  const dir = docsDir || getDocsPath();
  const fullPath = path.join(dir, docPath + ".md");
  
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read AGENTS.md from a docs subdirectory.
 * E.g., "store" → docs/store/AGENTS.md
 *        "" → docs/AGENTS.md (root)
 */
export function readAgentsAt(dirPath: string, docsDir?: string): string | null {
  const dir = docsDir || getDocsPath();
  const fullPath = dirPath
    ? path.join(dir, dirPath, "AGENTS.md")
    : path.join(dir, "AGENTS.md");
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Inject virtual "agents" entries into directories that have an AGENTS.md file.
 */
export function injectAgentsEntries(tree: DocEntry[], docsPath: string): void {
  for (const entry of tree) {
    if (entry.type !== "directory" || !entry.children) continue;

    // Check if this directory has an AGENTS.md
    const agentsFile = path.join(docsPath, entry.path, "AGENTS.md");
    if (fs.existsSync(agentsFile)) {
      if (!entry.children.some((c) => c.name === "agents")) {
        entry.children.unshift({
          name: "agents",
          path: `${entry.path}/agents`,
          type: "file",
        });
      }
    }

    // Recurse into subdirectories
    injectAgentsEntries(entry.children, docsPath);
  }
}

/**
 * Main docs command handler
 */
export async function handleDocs(args: { document?: string }): Promise<void> {
  const docsPath = getDocsPath();
  const tree = buildDocTree(docsPath);
  injectAgentsEntries(tree, docsPath);

  // Check if root docs/AGENTS.md exists → inject top-level agents entry
  const rootAgentsPath = path.join(docsPath, "AGENTS.md");
  const hasRootAgents = fs.existsSync(rootAgentsPath);

  // No argument: show full tree
  if (!args.document) {
    // Build display tree with agents at top if available
    const displayTree: DocEntry[] = hasRootAgents
      ? [{ name: "agents", path: "agents", type: "file" }, ...tree]
      : tree;

    console.log(`
📚 DevLink Documentation

${formatTree(displayTree)}

Usage:
  devlink docs <document>              Show document content
  devlink docs <directory>             List documents in directory

Examples:
  devlink docs agents.md               Agent guide (root)
  devlink docs store                   List store documents
  devlink docs store/namespaces.md     Show namespaces documentation
`);
    return;
  }
  
  const searchPath = args.document;
  const normalizedSearch = normalizePath(searchPath);
  
  // Top-level aliases: "agents" → root docs/AGENTS.md
  if (normalizedSearch === "agents" || normalizedSearch === "agent" || normalizedSearch === "ai") {
    const content = readAgentsAt("");
    if (content) {
      console.log(content);
      return;
    }
    console.error("Error: docs/AGENTS.md not found");
    process.exit(1);
  }

  // Check if path ends with "/agents" → read AGENTS.md from that directory
  if (normalizedSearch.endsWith("/agents")) {
    const dirPath = normalizedSearch.replace(/\/agents$/, "");
    const content = readAgentsAt(dirPath);
    if (content) {
      console.log(content);
      return;
    }
    // Fall through to tree search
  }
  
  // Search in tree
  const result = findDocument(tree, searchPath);
  
  if (!result) {
    const displayTree: DocEntry[] = hasRootAgents
      ? [{ name: "agents", path: "agents", type: "file" }, ...tree]
      : tree;
    console.error(`Document not found: ${searchPath}`);
    console.error("");
    console.error("Available documents:");
    console.error(formatTree(displayTree));
    process.exit(1);
  }
  
  const { entry, fullPath } = result;
  
  if (entry.type === "directory") {
    // Show directory listing
    console.log(formatDirectoryListing(entry));
    return;
  }

  // For "agents" entries in the tree, read from AGENTS.md in parent dir
  if (entry.name === "agents") {
    const dirPath = fullPath.replace(/\/agents$/, "");
    const content = readAgentsAt(dirPath);
    if (content) {
      console.log(content);
      return;
    }
  }
  
  // Read and display file
  const content = readDocument(fullPath);
  if (content) {
    console.log(content);
  } else {
    console.error(`Error: Could not read ${fullPath}.md`);
    process.exit(1);
  }
}

/**
 * Print docs help
 */
export function printDocsHelp(): void {
  console.log(`
devlink docs - Display embedded documentation

USAGE
  devlink docs [document]

DESCRIPTION
  Access DevLink documentation directly from the command line.
  Without arguments, shows the documentation tree.
  With a document path, displays that document's content.
  With a directory path, lists documents in that directory.

ARGUMENTS
  [document]    Document or directory path (case insensitive, .md optional)

EXAMPLES
  devlink docs                         Show documentation tree
  devlink docs agents.md               AI agent guide (comprehensive)
  devlink docs store                   List store documents
  devlink docs store/namespaces.md     Show namespaces documentation
  devlink docs STORE/NAMESPACES        Same (case insensitive, .md optional)
  devlink docs publishing/push.md      Show push command documentation

SPECIAL DOCUMENTS
  agents    Complete self-contained guide for AI agents
`);
}
