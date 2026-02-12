/**
 * Install Command - Instalar paquetes desde el store
 */

import fs from "fs/promises";
import path from "path";
import type { DevLinkConfig, ModeConfig, ResolvedPackage, Lockfile, InstalledPackage } from "../types.js";
import { withStoreLock } from "../core/lock.js";
import { readRegistry } from "../core/registry.js";
import { readInstallations, writeInstallations, registerProject } from "../core/installations.js";
import { resolvePackage } from "../core/resolver.js";
import { getPackagePath, DEFAULT_NAMESPACE, LOCKFILE_NAME, DEFAULT_CONFIG_FILES } from "../constants.js";

/**
 * Load configuration file
 */
async function loadConfig(configPath?: string): Promise<DevLinkConfig> {
  const cwd = process.cwd();
  
  if (configPath) {
    const fullPath = path.resolve(cwd, configPath);
    const config = await import(fullPath);
    return config.default || config;
  }
  
  // Try default config files
  for (const filename of DEFAULT_CONFIG_FILES) {
    const fullPath = path.join(cwd, filename);
    try {
      await fs.access(fullPath);
      const config = await import(fullPath);
      return config.default || config;
    } catch {
      // File doesn't exist, try next
    }
  }
  
  throw new Error(
    `No configuration file found. Looked for: ${DEFAULT_CONFIG_FILES.join(", ")}`
  );
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
 * Link package to node_modules
 */
async function linkPackage(
  projectPath: string,
  packageName: string,
  sourcePath: string
): Promise<void> {
  const nodeModulesPath = path.join(projectPath, "node_modules");
  let targetPath: string;
  
  if (packageName.startsWith("@")) {
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
 * Read lockfile
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
 * Write lockfile
 */
async function writeLockfile(projectPath: string, lockfile: Lockfile): Promise<void> {
  const lockfilePath = path.join(projectPath, LOCKFILE_NAME);
  await fs.writeFile(lockfilePath, JSON.stringify(lockfile, null, 2));
}


export interface InstallOptions {
  config?: string;
  mode?: "dev" | "prod";
  namespaces?: string[];
}

export interface InstallResult {
  installed: ResolvedPackage[];
  skipped: { name: string; version: string; reason: string }[];
}

/**
 * Install packages from store based on config
 */
export async function installPackages(options: InstallOptions = {}): Promise<InstallResult> {
  const projectPath = process.cwd();
  const config = await loadConfig(options.config);
  
  // Determine mode
  let mode: "dev" | "prod" = options.mode || "dev";
  if (!options.mode && config.detectMode) {
    const ctx = {
      env: process.env,
      args: process.argv,
      cwd: projectPath,
      packages: config.packages,
    };
    mode = config.detectMode(ctx);
  }
  
  // Get mode config
  const ctx = {
    env: process.env,
    args: process.argv,
    cwd: projectPath,
    packages: config.packages,
  };
  const modeConfig: ModeConfig = mode === "dev" ? config.dev(ctx) : config.prod(ctx);
  
  // If using npm manager, skip store installation
  if (modeConfig.manager === "npm") {
    console.log("Using npm manager, skipping store installation");
    return { installed: [], skipped: [] };
  }
  
  // Determine namespaces to search
  const namespaces = options.namespaces || modeConfig.namespaces || [DEFAULT_NAMESPACE];
  
  const result: InstallResult = {
    installed: [],
    skipped: [],
  };
  
  const registry = await readRegistry();
  const lockfile = await readLockfile(projectPath);
  const installedPackages: Record<string, InstalledPackage> = {};
  
  // Run beforeAll hook
  if (modeConfig.beforeAll) {
    await modeConfig.beforeAll();
  }
  
  // Process each package
  for (const [pkgName, versions] of Object.entries(config.packages)) {
    const version = mode === "dev" ? versions.dev : versions.prod;
    if (!version) {
      result.skipped.push({ name: pkgName, version: "N/A", reason: `No ${mode} version specified` });
      continue;
    }
    
    // Resolve package
    const resolution = resolvePackage(pkgName, version, namespaces, registry);
    
    if (!resolution.found) {
      result.skipped.push({
        name: pkgName,
        version,
        reason: `Not found in namespaces: ${namespaces.join(", ")}`,
      });
      continue;
    }
    
    const resolved: ResolvedPackage = {
      name: pkgName,
      version,
      qname: `${pkgName}@${version}`,
      namespace: resolution.namespace,
      path: resolution.path,
      signature: resolution.signature,
    };
    
    // Run beforeEach hook
    if (modeConfig.beforeEach) {
      await modeConfig.beforeEach(resolved);
    }
    
    // Link package
    await linkPackage(projectPath, pkgName, resolution.path!);
    
    // Update lockfile
    lockfile.packages[pkgName] = {
      version,
      signature: resolution.signature!,
      namespace: resolution.namespace,
    };
    
    // Track installation
    installedPackages[pkgName] = {
      version,
      namespace: resolution.namespace!,
      signature: resolution.signature!,
      installedAt: new Date().toISOString(),
    };
    
    result.installed.push(resolved);
    
    // Run afterEach hook
    if (modeConfig.afterEach) {
      await modeConfig.afterEach(resolved);
    }
  }
  
  // Run afterAll hook
  if (modeConfig.afterAll) {
    await modeConfig.afterAll();
  }
  
  // Save lockfile
  await writeLockfile(projectPath, lockfile);
  
  // Register project in installations (with lock)
  if (Object.keys(installedPackages).length > 0) {
    await withStoreLock(async () => {
      const installations = await readInstallations();
      registerProject(installations, projectPath, installedPackages);
      await writeInstallations(installations);
    });
  }
  
  return result;
}

/**
 * CLI handler for install command
 */
export async function handleInstall(args: {
  config?: string;
  dev?: boolean;
  prod?: boolean;
  namespaces?: string[];
}): Promise<void> {
  try {
    const mode = args.prod ? "prod" : args.dev ? "dev" : undefined;
    
    console.log(`📦 Installing packages${mode ? ` (${mode} mode)` : ""}...`);
    
    const result = await installPackages({
      config: args.config,
      mode,
      namespaces: args.namespaces,
    });
    
    if (result.installed.length > 0) {
      console.log(`\n✓ Installed ${result.installed.length} package(s):`);
      for (const pkg of result.installed) {
        console.log(`  - ${pkg.name}@${pkg.version} (${pkg.namespace})`);
      }
    }
    
    if (result.skipped.length > 0) {
      console.log(`\n⚠️  Skipped ${result.skipped.length} package(s):`);
      for (const pkg of result.skipped) {
        console.log(`  - ${pkg.name}@${pkg.version}: ${pkg.reason}`);
      }
    }
    
    if (result.installed.length === 0 && result.skipped.length === 0) {
      console.log("No packages to install");
    }
  } catch (error: any) {
    console.error(`✗ Install failed: ${error.message}`);
    process.exit(1);
  }
}
