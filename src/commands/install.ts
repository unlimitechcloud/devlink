/**
 * Install Command - Instalar paquetes desde el store
 */

import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import type { DevLinkConfig, ModeConfig, ModeFactory, ResolvedPackage, Lockfile, InstalledPackage } from "../types.js";
import { withStoreLock } from "../core/lock.js";
import { readRegistry } from "../core/registry.js";
import { readInstallations, writeInstallations, registerProject } from "../core/installations.js";
import { resolvePackage } from "../core/resolver.js";
import { DEFAULT_NAMESPACE, LOCKFILE_NAME, DEFAULT_CONFIG_FILES } from "../constants.js";
import { stageAndRelink, STAGING_DIR } from "../core/staging.js";
import type { StagedPackage } from "../core/staging.js";

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
 * Link bin entries from a package into node_modules/.bin/
 * Reads the `bin` field from the installed package's package.json
 * and creates symlinks in .bin/ just like npm would.
 */
async function linkBinEntries(projectPath: string, packageName: string): Promise<number> {
  const nodeModulesPath = path.join(projectPath, "node_modules");
  const pkgDir = packageName.startsWith("@")
    ? path.join(nodeModulesPath, ...packageName.split("/"))
    : path.join(nodeModulesPath, packageName);

  let manifest: any;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf-8"));
  } catch {
    return 0;
  }

  if (!manifest.bin) return 0;

  const binDir = path.join(nodeModulesPath, ".bin");
  await fs.mkdir(binDir, { recursive: true });

  // Normalize bin field: string → { name: string }, object → as-is
  const binEntries: Record<string, string> =
    typeof manifest.bin === "string"
      ? { [manifest.name.split("/").pop()!]: manifest.bin }
      : manifest.bin;

  let linked = 0;
  for (const [binName, relTarget] of Object.entries(binEntries)) {
    const targetAbsolute = path.resolve(pkgDir, relTarget);
    const linkPath = path.join(binDir, binName);

    // Remove existing
    await fs.rm(linkPath, { force: true });

    // Create relative symlink (like npm does)
    const relativeTarget = path.relative(binDir, targetAbsolute);
    await fs.symlink(relativeTarget, linkPath);

    // Make target executable
    try {
      await fs.chmod(targetAbsolute, 0o755);
    } catch {
      // Best effort
    }

    linked++;
  }

  return linked;
}

/**
 * Remove broken symlinks from node_modules/.bin/
 * Returns the number of broken links removed.
 */
async function cleanBrokenBinLinks(projectPath: string): Promise<number> {
  const binDir = path.join(projectPath, "node_modules", ".bin");

  let entries: string[];
  try {
    entries = await fs.readdir(binDir);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    const linkPath = path.join(binDir, entry);
    try {
      const lstats = await fs.lstat(linkPath);
      if (!lstats.isSymbolicLink()) continue;

      // stat follows the symlink — if it throws, the target is gone
      await fs.stat(linkPath);
    } catch {
      // Broken symlink — remove it
      await fs.rm(linkPath, { force: true });
      removed++;
    }
  }

  return removed;
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
  mode?: string;
  namespaces?: string[];
  runNpm?: boolean;
  runScripts?: boolean;
}

export interface InstallResult {
  installed: ResolvedPackage[];
  removed: string[];
  skipped: { name: string; version: string; reason: string }[];
  npmExitCode?: number;
}

/**
 * Run npm install
 */
async function runNpmInstall(runScripts: boolean = false): Promise<number> {
  return new Promise((resolve) => {
    const args = ["install", "--no-audit", "--legacy-peer-deps"];
    
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
 * Backup/restore for package.json when injecting devlink packages
 */
interface PackageJsonBackup {
  packageJsonPath: string;
  originalContent: string;
  restored: boolean;
}

/**
 * Restore the original package.json content
 */
async function restorePackageJson(backup: PackageJsonBackup): Promise<void> {
  if (backup.restored) return;
  try {
    await fs.writeFile(backup.packageJsonPath, backup.originalContent);
  } catch {
    // Best effort
  }
  backup.restored = true;
}

/**
 * Inject staged packages as file: dependencies, registry packages as exact versions,
 * and remove excluded packages from the project's package.json.
 */
async function injectStagedPackages(
  projectPath: string,
  stagedPackages: StagedPackage[],
  removePackageNames: string[] = [],
  registryPackages: { name: string; version: string }[] = []
): Promise<PackageJsonBackup> {
  const packageJsonPath = path.join(projectPath, "package.json");
  const originalContent = await fs.readFile(packageJsonPath, "utf-8");
  const backup: PackageJsonBackup = { packageJsonPath, originalContent, restored: false };

  const manifest = JSON.parse(originalContent);
  manifest.dependencies = manifest.dependencies || {};

  // Inject store packages as file: protocol
  for (const pkg of stagedPackages) {
    const relativePath = path.relative(projectPath, pkg.stagingPath);
    manifest.dependencies[pkg.name] = `file:${relativePath}`;
  }

  // Inject registry packages as exact versions (npm resolves from configured registry)
  for (const pkg of registryPackages) {
    manifest.dependencies[pkg.name] = pkg.version;
  }

  // Remove packages that don't have a version for the current mode
  for (const pkgName of removePackageNames) {
    delete manifest.dependencies[pkgName];
    if (manifest.devDependencies) delete manifest.devDependencies[pkgName];
  }

  await fs.writeFile(packageJsonPath, JSON.stringify(manifest, null, 2) + "\n");
  return backup;
}

/**
 * Install packages from store based on config
 */
export async function installPackages(options: InstallOptions = {}): Promise<InstallResult> {
  const projectPath = process.cwd();
  const config = await loadConfig(options.config);
  
  // Determine mode
  let mode: string = options.mode || "dev";
  if (!options.mode && config.detectMode) {
    const ctx = {
      env: process.env,
      args: process.argv,
      cwd: projectPath,
      packages: config.packages,
    };
    mode = config.detectMode(ctx);
  }
  
  // Get mode config (look up factory by mode name)
  const ctx = {
    env: process.env,
    args: process.argv,
    cwd: projectPath,
    packages: config.packages,
  };
  const modeFactory = config[mode] as ModeFactory | undefined;
  if (!modeFactory || typeof modeFactory !== "function") {
    throw new Error(`Mode "${mode}" is not defined in devlink.config.mjs`);
  }
  const modeConfig: ModeConfig = modeFactory(ctx);
  
  // If using npm manager and --npm flag is NOT set, skip entirely
  if (modeConfig.manager === "npm" && !options.runNpm) {
    console.log("Using npm manager, skipping store installation");
    return { installed: [], removed: [], skipped: [] };
  }
  
  // Determine namespaces to search
  const namespaces = options.namespaces || modeConfig.namespaces || [DEFAULT_NAMESPACE];
  
  const result: InstallResult = {
    installed: [],
    removed: [],
    skipped: [],
  };
  
  const registry = await readRegistry();
  const lockfile = await readLockfile(projectPath);
  const installedPackages: Record<string, InstalledPackage> = {};
  
  // Run beforeAll hook
  if (modeConfig.beforeAll) {
    await modeConfig.beforeAll();
  }
  
  // ================================================================
  // NEW: If --npm flag, use staging + file: protocol flow
  // ================================================================
  if (options.runNpm) {
    const isNpmManager = modeConfig.manager === "npm";
    
    // Phase 1: Resolve all packages
    const resolvedPackages: ResolvedPackage[] = [];
    const registryPackages: { name: string; version: string }[] = [];
    const removePackageNames: string[] = [];
    for (const [pkgName, versions] of Object.entries(config.packages)) {
      const version = versions[mode];
      if (!version) {
        // No version for this mode → remove from package.json
        removePackageNames.push(pkgName);
        continue;
      }
      
      // When manager is "npm", packages are resolved by npm from registry
      // — inject them as exact versions so npm fetches from configured registry
      if (isNpmManager) {
        registryPackages.push({ name: pkgName, version });
        continue;
      }
      
      const resolution = resolvePackage(pkgName, version, namespaces, registry);
      if (!resolution.found) {
        result.skipped.push({ name: pkgName, version, reason: `Not found in namespaces: ${namespaces.join(", ")}` });
        continue;
      }
      
      resolvedPackages.push({
        name: pkgName,
        version,
        qname: `${pkgName}@${version}`,
        namespace: resolution.namespace,
        path: resolution.path,
        signature: resolution.signature,
      });
    }
    
    if (resolvedPackages.length === 0 && registryPackages.length === 0 && removePackageNames.length === 0) {
      // Still run npm install even if no devlink packages
      result.npmExitCode = await runNpmInstall(options.runScripts);
      return result;
    }

    if (removePackageNames.length > 0) {
      console.log(`\n🗑️  Removing ${removePackageNames.length} package(s) not in ${mode} mode:`);
      for (const name of removePackageNames) {
        console.log(`  - ${name}`);
      }
    }

    if (registryPackages.length > 0) {
      console.log(`\n📡 Injecting ${registryPackages.length} package(s) from registry:`);
      for (const pkg of registryPackages) {
        console.log(`  - ${pkg.name}@${pkg.version}`);
      }
    }
    
    // Phase 2: Stage + Re-link (only for store manager)
    if (resolvedPackages.length > 0) {
      console.log(`\n📦 Staging ${resolvedPackages.length} package(s) to ${STAGING_DIR}/...`);
    }
    const staging = resolvedPackages.length > 0
      ? await stageAndRelink(projectPath, resolvedPackages)
      : { staged: [], relinked: [] };
    
    if (staging.relinked.length > 0) {
      console.log(`  ↳ Re-linked ${staging.relinked.length} internal dependency(ies)`);
    }
    
    // Phase 3: Inject file: deps + registry deps + remove excluded + npm install
    const backup = await injectStagedPackages(projectPath, staging.staged, removePackageNames, registryPackages);
    result.removed = removePackageNames;
    
    // Register signal handlers for cleanup
    const onSignal = async () => {
      await restorePackageJson(backup);
      process.exit(1);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    
    try {
      result.npmExitCode = await runNpmInstall(options.runScripts);
      
      if (result.npmExitCode !== 0) {
        return result;
      }
      
      // Phase 3.5: Clean broken bin symlinks + link bin entries
      const brokenRemoved = await cleanBrokenBinLinks(projectPath);
      if (brokenRemoved > 0) {
        console.log(`  ↳ Cleaned ${brokenRemoved} broken bin symlink${brokenRemoved === 1 ? "" : "s"}`);
      }
      let totalBinLinks = 0;
      for (const pkg of resolvedPackages) {
        totalBinLinks += await linkBinEntries(projectPath, pkg.name);
      }
      if (totalBinLinks > 0) {
        console.log(`  ↳ Linked ${totalBinLinks} bin entr${totalBinLinks === 1 ? "y" : "ies"}`);
      }
      
      // Phase 4: Tracking
      for (const pkg of resolvedPackages) {
        lockfile.packages[pkg.name] = {
          version: pkg.version,
          signature: pkg.signature!,
          namespace: pkg.namespace,
        };
        
        installedPackages[pkg.name] = {
          version: pkg.version,
          namespace: pkg.namespace!,
          signature: pkg.signature!,
          installedAt: new Date().toISOString(),
        };
        
        result.installed.push(pkg);
      }

      // Track registry packages (resolved by npm, not from store)
      for (const pkg of registryPackages) {
        result.installed.push({
          name: pkg.name,
          version: pkg.version,
          qname: `${pkg.name}@${pkg.version}`,
          namespace: "registry",
        });
      }
      
      // Run afterAll hook
      if (modeConfig.afterAll) {
        await modeConfig.afterAll();
      }
      
      await writeLockfile(projectPath, lockfile);
      
      if (Object.keys(installedPackages).length > 0) {
        await withStoreLock(async () => {
          const installations = await readInstallations();
          registerProject(installations, projectPath, installedPackages);
          await writeInstallations(installations);
        });
      }
      
      return result;
    } finally {
      // ALWAYS restore package.json
      await restorePackageJson(backup);
      
      // Remove signal handlers
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
  }
  
  // ================================================================
  // EXISTING: Direct copy to node_modules (without --npm)
  // ================================================================

  // Clean broken bin symlinks before installing
  const brokenRemoved = await cleanBrokenBinLinks(projectPath);
  if (brokenRemoved > 0) {
    console.log(`  ↳ Cleaned ${brokenRemoved} broken bin symlink${brokenRemoved === 1 ? "" : "s"}`);
  }

  for (const [pkgName, versions] of Object.entries(config.packages)) {
    const version = versions[mode];
    if (!version) {
      result.skipped.push({ name: pkgName, version: "N/A", reason: `No ${mode} version specified` });
      continue;
    }
    
    const resolution = resolvePackage(pkgName, version, namespaces, registry);
    if (!resolution.found) {
      result.skipped.push({ name: pkgName, version, reason: `Not found in namespaces: ${namespaces.join(", ")}` });
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
    
    if (modeConfig.beforeEach) {
      await modeConfig.beforeEach(resolved);
    }
    
    await linkPackage(projectPath, pkgName, resolution.path!);
    await linkBinEntries(projectPath, pkgName);
    
    lockfile.packages[pkgName] = {
      version,
      signature: resolution.signature!,
      namespace: resolution.namespace,
    };
    
    installedPackages[pkgName] = {
      version,
      namespace: resolution.namespace!,
      signature: resolution.signature!,
      installedAt: new Date().toISOString(),
    };
    
    result.installed.push(resolved);
    
    if (modeConfig.afterEach) {
      await modeConfig.afterEach(resolved);
    }
  }
  
  if (modeConfig.afterAll) {
    await modeConfig.afterAll();
  }
  
  await writeLockfile(projectPath, lockfile);
  
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
  mode?: string;
  dev?: boolean;
  prod?: boolean;
  namespaces?: string[];
  npm?: boolean;
  runScripts?: boolean;
}): Promise<void> {
  try {
    const mode = args.mode || (args.prod ? "prod" : args.dev ? "dev" : undefined);
    
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

    if (result.removed.length > 0) {
      console.log(`\n✓ Removed ${result.removed.length} package(s) (not in mode):`);
      for (const name of result.removed) {
        console.log(`  - ${name}`);
      }
    }
    
    if (result.skipped.length > 0) {
      console.log(`\n⚠️  Skipped ${result.skipped.length} package(s):`);
      for (const pkg of result.skipped) {
        console.log(`  - ${pkg.name}@${pkg.version}: ${pkg.reason}`);
      }
    }
    
    if (result.installed.length === 0 && result.skipped.length === 0 && result.removed.length === 0) {
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
