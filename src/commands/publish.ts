/**
 * Publish Command - Publicar paquete al store
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { PackageManifest, PublishResult, VersionEntry } from "../types.js";
import { withStoreLock } from "../core/lock.js";
import { readRegistry, writeRegistry, addPackageToRegistry } from "../core/registry.js";
import { ensureNamespace, writePackageSignature } from "../core/store.js";
import { getPackagePath, DEFAULT_NAMESPACE, SIGNATURE_FILE } from "../constants.js";

/**
 * Read package.json from directory
 */
async function readPackageManifest(dir: string): Promise<PackageManifest> {
  const manifestPath = path.join(dir, "package.json");
  const content = await fs.readFile(manifestPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Get files to publish based on package.json files field or defaults
 */
async function getFilesToPublish(dir: string, manifest: PackageManifest): Promise<string[]> {
  const files: string[] = ["package.json"];
  
  if (manifest.files && manifest.files.length > 0) {
    // Use files field from package.json
    for (const pattern of manifest.files) {
      const matches = await globFiles(dir, pattern);
      files.push(...matches);
    }
  } else {
    // Default: include common directories
    const defaultDirs = ["dist", "lib", "build", "src"];
    for (const d of defaultDirs) {
      const dirPath = path.join(dir, d);
      try {
        const stat = await fs.stat(dirPath);
        if (stat.isDirectory()) {
          const dirFiles = await getAllFiles(dirPath, dir);
          files.push(...dirFiles);
        }
      } catch {
        // Directory doesn't exist
      }
    }
  }
  
  // Always include README and LICENSE if present
  for (const f of ["README.md", "README", "LICENSE", "LICENSE.md"]) {
    try {
      await fs.access(path.join(dir, f));
      if (!files.includes(f)) files.push(f);
    } catch {
      // File doesn't exist
    }
  }
  
  return [...new Set(files)];
}

/**
 * Simple glob implementation for file patterns
 */
async function globFiles(baseDir: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  
  // Handle directory patterns
  if (!pattern.includes("*")) {
    const fullPath = path.join(baseDir, pattern);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        const files = await getAllFiles(fullPath, baseDir);
        results.push(...files);
      } else {
        results.push(pattern);
      }
    } catch {
      // Path doesn't exist
    }
    return results;
  }
  
  // Handle glob patterns (simplified)
  const dir = path.dirname(pattern);
  const filePattern = path.basename(pattern);
  const searchDir = path.join(baseDir, dir === "." ? "" : dir);
  
  try {
    const entries = await fs.readdir(searchDir, { withFileTypes: true });
    const regex = new RegExp("^" + filePattern.replace(/\*/g, ".*") + "$");
    
    for (const entry of entries) {
      if (regex.test(entry.name)) {
        const relativePath = dir === "." ? entry.name : path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const files = await getAllFiles(path.join(searchDir, entry.name), baseDir);
          results.push(...files);
        } else {
          results.push(relativePath);
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }
  
  return results;
}

/**
 * Get all files in directory recursively
 */
async function getAllFiles(dir: string, baseDir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    if (entry.isDirectory()) {
      results.push(...await getAllFiles(fullPath, baseDir));
    } else {
      results.push(relativePath);
    }
  }
  
  return results;
}


/**
 * Copy files to destination
 */
async function copyFiles(
  srcDir: string,
  destDir: string,
  files: string[]
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  
  for (const file of files) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    
    // Ensure destination directory exists
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    
    // Copy file
    await fs.copyFile(srcPath, destPath);
  }
}

/**
 * Calculate signature (MD5 hash) of package contents
 */
async function calculateSignature(dir: string, files: string[]): Promise<string> {
  const hash = crypto.createHash("md5");
  
  // Sort files for deterministic hash
  const sortedFiles = [...files].sort();
  
  for (const file of sortedFiles) {
    const filePath = path.join(dir, file);
    try {
      const content = await fs.readFile(filePath);
      hash.update(file);
      hash.update(content);
    } catch {
      // Skip files that can't be read
    }
  }
  
  return hash.digest("hex");
}

/**
 * Publish a package to the store
 */
export async function publishPackage(
  workingDir: string,
  namespace: string = DEFAULT_NAMESPACE
): Promise<PublishResult> {
  // Read package.json
  const manifest = await readPackageManifest(workingDir);
  
  if (!manifest.name || !manifest.version) {
    throw new Error("package.json must have name and version fields");
  }
  
  // Get files to publish
  const files = await getFilesToPublish(workingDir, manifest);
  
  if (files.length === 0) {
    throw new Error("No files to publish");
  }
  
  // Calculate destination path
  const destDir = getPackagePath(namespace, manifest.name, manifest.version);
  
  // Perform publish with lock
  return withStoreLock(async () => {
    // Ensure namespace exists
    await ensureNamespace(namespace);
    
    // Copy files
    await copyFiles(workingDir, destDir, files);
    
    // Calculate signature
    const signature = await calculateSignature(destDir, files);
    
    // Write signature file
    await writePackageSignature(namespace, manifest.name, manifest.version, signature);
    
    // Update registry
    const registry = await readRegistry();
    const entry: VersionEntry = {
      signature,
      published: new Date().toISOString(),
      files: files.length,
    };
    addPackageToRegistry(registry, namespace, manifest.name, manifest.version, entry);
    await writeRegistry(registry);
    
    return {
      name: manifest.name,
      version: manifest.version,
      namespace,
      signature,
      path: destDir,
      files: files.length,
    };
  });
}

/**
 * CLI handler for publish command
 */
export async function handlePublish(args: {
  namespace?: string;
  cwd?: string;
}): Promise<void> {
  const workingDir = args.cwd || process.cwd();
  const namespace = args.namespace || DEFAULT_NAMESPACE;
  
  console.log(`📦 Publishing from ${workingDir} to namespace '${namespace}'...`);
  
  try {
    const result = await publishPackage(workingDir, namespace);
    console.log(`✓ Published ${result.name}@${result.version}`);
    console.log(`  Namespace: ${result.namespace}`);
    console.log(`  Signature: ${result.signature.slice(0, 8)}`);
    console.log(`  Files: ${result.files}`);
  } catch (error: any) {
    console.error(`✗ Publish failed: ${error.message}`);
    process.exit(1);
  }
}
