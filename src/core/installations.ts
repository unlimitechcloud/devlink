/**
 * Installations - Tracking de proyectos consumidores
 */

import fs from "fs/promises";
import path from "path";
import type { Installations, ProjectEntry, InstalledPackage } from "../types.js";
import {
  getStorePath,
  getInstallationsPath,
  INSTALLATIONS_VERSION,
} from "../constants.js";

/**
 * Create empty installations
 */
export function createEmptyInstallations(): Installations {
  return {
    version: INSTALLATIONS_VERSION,
    projects: {},
  };
}

/**
 * Read installations from disk
 * Returns empty installations if file doesn't exist
 */
export async function readInstallations(): Promise<Installations> {
  const installationsPath = getInstallationsPath();
  
  try {
    const content = await fs.readFile(installationsPath, "utf-8");
    return JSON.parse(content) as Installations;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return createEmptyInstallations();
    }
    throw error;
  }
}

/**
 * Write installations to disk (atomic write)
 */
export async function writeInstallations(installations: Installations): Promise<void> {
  const installationsPath = getInstallationsPath();
  const storePath = getStorePath();
  
  // Ensure store directory exists
  await fs.mkdir(storePath, { recursive: true });
  
  // Write to temp file first, then rename (atomic)
  const tempPath = `${installationsPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(installations, null, 2));
  await fs.rename(tempPath, installationsPath);
}

/**
 * Normalize project path for consistent keys
 */
export function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

/**
 * Register or update a project's installed packages
 */
export function registerProject(
  installations: Installations,
  projectPath: string,
  packages: Record<string, InstalledPackage>
): void {
  const normalizedPath = normalizeProjectPath(projectPath);
  
  if (!installations.projects[normalizedPath]) {
    installations.projects[normalizedPath] = {
      registered: new Date().toISOString(),
      packages: {},
    };
  }
  
  // Merge packages
  installations.projects[normalizedPath].packages = {
    ...installations.projects[normalizedPath].packages,
    ...packages,
  };
}


/**
 * Update a single package in a project
 */
export function updateProjectPackage(
  installations: Installations,
  projectPath: string,
  packageName: string,
  info: InstalledPackage
): void {
  const normalizedPath = normalizeProjectPath(projectPath);
  
  if (!installations.projects[normalizedPath]) {
    installations.projects[normalizedPath] = {
      registered: new Date().toISOString(),
      packages: {},
    };
  }
  
  installations.projects[normalizedPath].packages[packageName] = info;
}

/**
 * Unregister a project completely
 */
export function unregisterProject(
  installations: Installations,
  projectPath: string
): boolean {
  const normalizedPath = normalizeProjectPath(projectPath);
  
  if (!installations.projects[normalizedPath]) {
    return false;
  }
  
  delete installations.projects[normalizedPath];
  return true;
}

/**
 * Remove a package from a project
 */
export function removePackageFromProject(
  installations: Installations,
  projectPath: string,
  packageName: string
): boolean {
  const normalizedPath = normalizeProjectPath(projectPath);
  const project = installations.projects[normalizedPath];
  
  if (!project || !project.packages[packageName]) {
    return false;
  }
  
  delete project.packages[packageName];
  
  // Clean up empty project
  if (Object.keys(project.packages).length === 0) {
    delete installations.projects[normalizedPath];
  }
  
  return true;
}

/**
 * Get all projects that consume a specific package
 */
export function getConsumers(
  installations: Installations,
  packageName: string,
  options?: { namespace?: string; version?: string }
): { projectPath: string; info: InstalledPackage }[] {
  const consumers: { projectPath: string; info: InstalledPackage }[] = [];
  
  for (const [projectPath, project] of Object.entries(installations.projects)) {
    const pkgInfo = project.packages[packageName];
    if (!pkgInfo) continue;
    
    // Filter by namespace if specified
    if (options?.namespace && pkgInfo.namespace !== options.namespace) {
      continue;
    }
    
    // Filter by version if specified
    if (options?.version && pkgInfo.version !== options.version) {
      continue;
    }
    
    consumers.push({ projectPath, info: pkgInfo });
  }
  
  return consumers;
}

/**
 * Get all consumers in a specific namespace
 */
export function getConsumersByNamespace(
  installations: Installations,
  namespace: string
): { projectPath: string; packages: Record<string, InstalledPackage> }[] {
  const results: { projectPath: string; packages: Record<string, InstalledPackage> }[] = [];
  
  for (const [projectPath, project] of Object.entries(installations.projects)) {
    const matchingPackages: Record<string, InstalledPackage> = {};
    
    for (const [pkgName, pkgInfo] of Object.entries(project.packages)) {
      if (pkgInfo.namespace === namespace) {
        matchingPackages[pkgName] = pkgInfo;
      }
    }
    
    if (Object.keys(matchingPackages).length > 0) {
      results.push({ projectPath, packages: matchingPackages });
    }
  }
  
  return results;
}

/**
 * Check if a project path exists on disk
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
 * Prune dead projects (projects that no longer exist on disk)
 * Returns list of removed project paths
 */
export async function pruneDeadProjects(
  installations: Installations
): Promise<string[]> {
  const removed: string[] = [];
  
  for (const projectPath of Object.keys(installations.projects)) {
    if (!(await projectExists(projectPath))) {
      delete installations.projects[projectPath];
      removed.push(projectPath);
    }
  }
  
  return removed;
}

/**
 * Get all registered projects
 */
export function getAllProjects(installations: Installations): string[] {
  return Object.keys(installations.projects).sort();
}

/**
 * Get project entry
 */
export function getProject(
  installations: Installations,
  projectPath: string
): ProjectEntry | null {
  const normalizedPath = normalizeProjectPath(projectPath);
  return installations.projects[normalizedPath] || null;
}

/**
 * Get total project count
 */
export function getTotalProjectCount(installations: Installations): number {
  return Object.keys(installations.projects).length;
}

/**
 * Get all unique packages across all projects
 */
export function getAllInstalledPackages(
  installations: Installations
): { packageName: string; consumers: number }[] {
  const packageMap = new Map<string, number>();
  
  for (const project of Object.values(installations.projects)) {
    for (const pkgName of Object.keys(project.packages)) {
      packageMap.set(pkgName, (packageMap.get(pkgName) || 0) + 1);
    }
  }
  
  return Array.from(packageMap.entries())
    .map(([packageName, consumers]) => ({ packageName, consumers }))
    .sort((a, b) => a.packageName.localeCompare(b.packageName));
}
