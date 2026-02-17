/**
 * Install Command - Instalar paquetes desde el store
 */

import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import type { DevLinkConfig, ModeConfig, ResolvedPackage, Lockfile, InstalledPackage, PackageManifest } from "../types.js";
import { withStoreLock } from "../core/lock.js";
import { readRegistry } from "../core/registry.js";
import { readInstallations, writeInstallations, registerProject } from "../core/installations.js";
import { resolvePackage } from "../core/resolver.js";
import { getPackagePath, DEFAULT_NAMESPACE, LOCKFILE_NAME, DEFAULT_CONFIG_FILES } from "../constants.js";

/**
 * Check if a package name matches a glob pattern
 * Supports simple patterns like "@scope/*" or exact matches
 */
function matchesPattern(packageName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // Remove the *
    return packageName.startsWith(prefix);
  }
  return packageName === pattern;
}

/**
 * Check if a package name matches any of the patterns
 */
function matchesAnyPattern(packageName: string, patterns: string[]): boolean {
  return patterns.some(pattern => matchesPattern(packageName, pattern));
}

/**
 * Transform package.json to mark matching dependencies as optional peerDependencies
 * This modifies the copied package.json in node_modules, not the original in the store
 */
async function applyPeerOptional(
  packageJsonPath: string,
  peerOptionalPatterns: string[]
): Promise<void> {
  const content = await fs.readFile(packageJsonPath, "utf-8");
  const manifest: PackageManifest & { peerDependenciesMeta?: Record<string, { optional?: boolean }> } = JSON.parse(content);
  
  let modified = false;
  
  // Process dependencies - move matching ones to peerDependencies with optional meta
  if (manifest.dependencies) {
    const depsToMove: string[] = [];
    
    for (const depName of Object.keys(manifest.dependencies)) {
      if (matchesAnyPattern(depName, peerOptionalPatterns)) {
        depsToMove.push(depName);
      }
    }
    
    if (depsToMove.length > 0) {
      // Initialize peerDependencies and peerDependenciesMeta if needed
      manifest.peerDependencies = manifest.peerDependencies || {};
      manifest.peerDependenciesMeta = manifest.peerDependenciesMeta || {};
      
      for (const depName of depsToMove) {
        const version = manifest.dependencies[depName];
        
        // Move to peerDependencies
        manifest.peerDependencies[depName] = version;
        
        // Mark as optional
        manifest.peerDependenciesMeta[depName] = { optional: true };
        
        // Remove from dependencies
        delete manifest.dependencies[depName];
      }
      
      // Clean up empty dependencies object
      if (Object.keys(manifest.dependencies).length === 0) {
        delete manifest.dependencies;
      }
      
      modified = true;
    }
  }
  
  // Also mark existing peerDependencies as optional if they match
  if (manifest.peerDependencies) {
    manifest.peerDependenciesMeta = manifest.peerDependenciesMeta || {};
    
    for (const depName of Object.keys(manifest.peerDependencies)) {
      if (matchesAnyPattern(depName, peerOptionalPatterns) && !manifest.peerDependenciesMeta[depName]) {
        manifest.peerDependenciesMeta[depName] = { optional: true };
        modified = true;
      }
    }
  }
  
  if (modified) {
    await fs.writeFile(packageJsonPath, JSON.stringify(manifest, null, 2));
  }
}

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
  sourcePath: string,
  peerOptionalPatterns?: string[]
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
  
  // Apply peerOptional transformations if configured
  if (peerOptionalPatterns && peerOptionalPatterns.length > 0) {
    const packageJsonPath = path.join(targetPath, "package.json");
    try {
      await applyPeerOptional(packageJsonPath, peerOptionalPatterns);
    } catch {
      // Ignore if package.json doesn't exist or can't be modified
    }
  }
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
  runNpm?: boolean;
  runScripts?: boolean;
}

export interface InstallResult {
  installed: ResolvedPackage[];
  skipped: { name: string; version: string; reason: string }[];
  npmExitCode?: number;
}

/**
 * Run npm install
 * By default uses --ignore-scripts to avoid loops with preinstall/postinstall
 * Use runScripts=true to allow scripts to run
 */
async function runNpmInstall(runScripts: boolean = false): Promise<number> {
  return new Promise((resolve) => {
    const args = ["install"];
    if (!runScripts) {
      args.push("--ignore-scripts");
    }
    
    console.log(`\n📦 Running npm ${args.join(" ")}...`);
    
    const npm = spawn("npm", args, {
      stdio: "inherit",
      shell: true,
    });
    
    npm.on("close", (code) => {
      resolve(code ?? 0);
    });
    
    npm.on("error", () => {
      resolve(1);
    });
  });
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
  
  // If --npm flag is set, run npm install FIRST, then install DevLink packages
  // This ensures DevLink packages are not removed by npm's prune
  if (options.runNpm) {
    result.npmExitCode = await runNpmInstall(options.runScripts);
    if (result.npmExitCode !== 0) {
      return result;
    }
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
    await linkPackage(projectPath, pkgName, resolution.path!, modeConfig.peerOptional);
    
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
  npm?: boolean;
  runScripts?: boolean;
}): Promise<void> {
  try {
    const mode = args.prod ? "prod" : args.dev ? "dev" : undefined;
    
    console.log(`📦 Installing packages${mode ? ` (${mode} mode)` : ""}...`);
    
    const result = await installPackages({
      config: args.config,
      mode,
      namespaces: args.namespaces,
      runNpm: args.npm,
      runScripts: args.runScripts,
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
    
    // Report npm result if it was run
    if (args.npm) {
      if (result.npmExitCode === 0) {
        console.log("\n✓ npm install completed successfully");
      } else {
        console.error(`\n✗ npm install failed with exit code ${result.npmExitCode}`);
        process.exit(result.npmExitCode || 1);
      }
    }
  } catch (error: any) {
    console.error(`✗ Install failed: ${error.message}`);
    process.exit(1);
  }
}
