/**
 * Push Command - Publicar y actualizar consumidores
 */

import fs from "fs/promises";
import path from "path";
import type { PushResult, InstalledPackage, Lockfile } from "../types.js";
import { withStoreLock } from "../core/lock.js";
import { readRegistry, writeRegistry, addPackageToRegistry } from "../core/registry.js";
import {
  readInstallations,
  writeInstallations,
  getConsumers,
  updateProjectPackage,
} from "../core/installations.js";
import { ensureNamespace, writePackageSignature } from "../core/store.js";
import { getPackagePath, DEFAULT_NAMESPACE, LOCKFILE_NAME } from "../constants.js";
import { publishPackage } from "./publish.js";

/**
 * Read lockfile from project
 */
async function readLockfile(projectPath: string): Promise<Lockfile> {
  const lockfilePath = path.join(projectPath, LOCKFILE_NAME);
  try {
    const content = await fs.readFile(lockfilePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return { packages: {} };
  }
}

/**
 * Write lockfile to project
 */
async function writeLockfile(projectPath: string, lockfile: Lockfile): Promise<void> {
  const lockfilePath = path.join(projectPath, LOCKFILE_NAME);
  await fs.writeFile(lockfilePath, JSON.stringify(lockfile, null, 2));
}

/**
 * Check if project directory exists
 */
async function projectExists(projectPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(projectPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Link package to project's node_modules
 */
async function linkPackageToProject(
  projectPath: string,
  packageName: string,
  sourcePath: string
): Promise<void> {
  const nodeModulesPath = path.join(projectPath, "node_modules");
  let targetPath: string;
  
  if (packageName.startsWith("@")) {
    // Scoped package
    const [scope, name] = packageName.split("/");
    targetPath = path.join(nodeModulesPath, scope, name);
  } else {
    targetPath = path.join(nodeModulesPath, packageName);
  }
  
  // Remove existing
  await fs.rm(targetPath, { recursive: true, force: true });
  
  // Create parent directory
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  
  // Copy package
  await copyDir(sourcePath, targetPath);
}

/**
 * Copy directory recursively
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Push a package: publish and update all consumers
 */
export async function pushPackage(
  workingDir: string,
  namespace: string = DEFAULT_NAMESPACE
): Promise<PushResult> {
  // First, publish the package
  const publishResult = await publishPackage(workingDir, namespace);
  
  const updatedProjects: string[] = [];
  const skippedProjects: string[] = [];
  
  // Then update consumers (with lock)
  await withStoreLock(async () => {
    const installations = await readInstallations();
    const consumers = getConsumers(installations, publishResult.name);
    
    for (const consumer of consumers) {
      const { projectPath, info } = consumer;
      
      // Check if project still exists
      if (!(await projectExists(projectPath))) {
        skippedProjects.push(projectPath);
        continue;
      }
      
      try {
        // Link package to project
        const sourcePath = getPackagePath(namespace, publishResult.name, publishResult.version);
        await linkPackageToProject(projectPath, publishResult.name, sourcePath);
        
        // Update installations tracking
        const newInfo: InstalledPackage = {
          version: publishResult.version,
          namespace,
          signature: publishResult.signature,
          installedAt: new Date().toISOString(),
        };
        updateProjectPackage(installations, projectPath, publishResult.name, newInfo);
        
        // Update project's lockfile
        const lockfile = await readLockfile(projectPath);
        lockfile.packages[publishResult.name] = {
          version: publishResult.version,
          signature: publishResult.signature,
          namespace,
        };
        await writeLockfile(projectPath, lockfile);
        
        updatedProjects.push(projectPath);
      } catch (error) {
        skippedProjects.push(projectPath);
      }
    }
    
    // Save updated installations
    await writeInstallations(installations);
  });
  
  return {
    ...publishResult,
    updatedProjects,
    skippedProjects,
  };
}

/**
 * CLI handler for push command
 */
export async function handlePush(args: {
  namespace?: string;
  cwd?: string;
}): Promise<void> {
  const workingDir = args.cwd || process.cwd();
  const namespace = args.namespace || DEFAULT_NAMESPACE;
  
  console.log(`🚀 Pushing from ${workingDir} to namespace '${namespace}'...`);
  
  try {
    const result = await pushPackage(workingDir, namespace);
    console.log(`✓ Published ${result.name}@${result.version}`);
    console.log(`  Namespace: ${result.namespace}`);
    console.log(`  Signature: ${result.signature.slice(0, 8)}`);
    
    if (result.updatedProjects.length > 0) {
      console.log(`\n📦 Updated ${result.updatedProjects.length} project(s):`);
      for (const project of result.updatedProjects) {
        console.log(`  ✓ ${project}`);
      }
    }
    
    if (result.skippedProjects.length > 0) {
      console.log(`\n⚠️  Skipped ${result.skippedProjects.length} project(s):`);
      for (const project of result.skippedProjects) {
        console.log(`  - ${project}`);
      }
    }
  } catch (error: any) {
    console.error(`✗ Push failed: ${error.message}`);
    process.exit(1);
  }
}
