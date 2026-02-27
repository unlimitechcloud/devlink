/**
 * Install Command - Instalar paquetes desde el store
 *
 * DevLink operates at the monorepo root only:
 * - Staging: copies packages from store to .devlink/
 * - Injection: rewrites root package.json with file: protocols
 * - npm install: resolves everything, hoists to root/node_modules
 * - Workspace members resolve DevLink packages by Node walk-up
 */

import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import type { DevLinkConfig, ModeConfig, ModeFactory, ResolvedPackage, Lockfile, InstalledPackage, NormalizedConfig } from "../types.js";
import { withStoreLock } from "../core/lock.js";
import { readRegistry } from "../core/registry.js";
import { readInstallations, writeInstallations, registerProject } from "../core/installations.js";
import { resolvePackage } from "../core/resolver.js";
import { DEFAULT_NAMESPACE, LOCKFILE_NAME, DEFAULT_CONFIG_FILES } from "../constants.js";
import { stageAndRelink, STAGING_DIR } from "../core/staging.js";
import type { StagedPackage } from "../core/staging.js";
import { normalizeConfig } from "../config.js";

/**
 * Load configuration file.
 *
 * @param configPath - Explicit path to config file (--config flag)
 * @param configName - Config file name override (--config-name flag); if not set, uses DEFAULT_CONFIG_FILES
 * @param configKey - Key within the config export to extract DevLink config from (e.g. "devlink")
 */
async function loadConfig(configPath?: string, configName?: string, configKey?: string): Promise<DevLinkConfig> {
  const cwd = process.cwd();

  if (configPath) {
    const fullPath = path.resolve(cwd, configPath);
    const mod = await import(fullPath);
    const raw = mod.default || mod;
    return configKey && raw[configKey] ? raw[configKey] : raw;
  }

  const fileNames = configName ? [configName] : [...DEFAULT_CONFIG_FILES];

  for (const filename of fileNames) {
    const fullPath = path.join(cwd, filename);
    try {
      await fs.access(fullPath);
      const mod = await import(fullPath);
      const raw = mod.default || mod;
      return configKey && raw[configKey] ? raw[configKey] : raw;
    } catch {
      // File doesn't exist, try next
    }
  }

  // Fallback: try default config files (only if no explicit configName was given)
  if (!configName) {
    for (const filename of DEFAULT_CONFIG_FILES) {
      const fullPath = path.join(cwd, filename);
      try {
        await fs.access(fullPath);
        const mod = await import(fullPath);
        const raw = mod.default || mod;
        return configKey && raw[configKey] ? raw[configKey] : raw;
      } catch {
        // File doesn't exist, try next
      }
    }
  }

  const searched = configName ? [configName] : [...DEFAULT_CONFIG_FILES];
  throw new Error(
    `No configuration file found. Looked for: ${searched.join(", ")}`
  );
}

/**
 * Link bin entries from a package into node_modules/.bin/
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

  const binEntries: Record<string, string> =
    typeof manifest.bin === "string"
      ? { [manifest.name.split("/").pop()!]: manifest.bin }
      : manifest.bin;

  let linked = 0;
  for (const [binName, relTarget] of Object.entries(binEntries)) {
    const targetAbsolute = path.resolve(pkgDir, relTarget);
    const linkPath = path.join(binDir, binName);
    await fs.rm(linkPath, { force: true });
    const relativeTarget = path.relative(binDir, targetAbsolute);
    await fs.symlink(relativeTarget, linkPath);
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
      await fs.stat(linkPath);
    } catch {
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
  
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
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

/**
 * Inject staged packages as file: dependencies into the local package.json.
 * Only modifies the root package.json — workspace members resolve by Node walk-up.
 */
async function injectStagedPackages(
  projectPath: string,
  stagedPackages: StagedPackage[],
  removePackageNames: string[] = [],
  registryPackages: { name: string; version: string }[] = [],
  syntheticPackages?: Set<string>
): Promise<void> {
  const packageJsonPath = path.join(projectPath, "package.json");
  const originalContent = await fs.readFile(packageJsonPath, "utf-8");
  const manifest = JSON.parse(originalContent);
  manifest.dependencies = manifest.dependencies || {};

  for (const pkg of stagedPackages) {
    if (syntheticPackages?.has(pkg.name)) continue;
    const relativePath = path.relative(projectPath, pkg.stagingPath);
    manifest.dependencies[pkg.name] = `file:${relativePath}`;
  }

  for (const pkg of registryPackages) {
    manifest.dependencies[pkg.name] = pkg.version;
  }

  for (const pkgName of removePackageNames) {
    delete manifest.dependencies[pkgName];
    if (manifest.devDependencies) delete manifest.devDependencies[pkgName];
  }

  await fs.writeFile(packageJsonPath, JSON.stringify(manifest, null, 2) + "\n");
}


export interface InstallOptions {
  config?: string;
  mode?: string;
  namespaces?: string[];
  runNpm?: boolean;
  runScripts?: boolean;
  /** Config file name override */
  configName?: string;
  /** Key within the config export to extract DevLink config from (e.g. "devlink") */
  configKey?: string;
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
 * Install packages from store based on config.
 * Operates on the current directory (root of monorepo).
 * Injects file: protocols into the local package.json only.
 */
export async function installPackages(options: InstallOptions = {}): Promise<InstallResult> {
  const projectPath = process.cwd();
  const config = await loadConfig(options.config, options.configName, options.configKey);
  
  // Normalize config once at the top level
  const normalized = normalizeConfig(config);
  
  // Build synthetic packages set
  const syntheticPackages = new Set<string>();
  for (const [pkgName, spec] of Object.entries(normalized.packages)) {
    if (spec.synthetic) syntheticPackages.add(pkgName);
  }
  if (syntheticPackages.size > 0) {
    console.log(`\n🔗 ${syntheticPackages.size} synthetic package(s) (store-only):`);
    for (const name of syntheticPackages) {
      console.log(`  - ${name}`);
    }
  }
  
  // Determine mode from CLI flag
  const mode: string = options.mode || "dev";
  
  // Get mode config
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
  // If --npm flag, use staging + injection + npm install
  // ================================================================
  if (options.runNpm) {
    const isNpmManager = modeConfig.manager === "npm";
    
    // Phase 1: Resolve all packages
    const resolvedPackages: ResolvedPackage[] = [];
    const registryPackages: { name: string; version: string }[] = [];
    const removePackageNames: string[] = [];
    for (const [pkgName, spec] of Object.entries(config.packages)) {
      const version = spec.version[mode];
      if (!version) {
        removePackageNames.push(pkgName);
        continue;
      }
      
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
      for (const pkg of resolvedPackages) {
        const synLabel = syntheticPackages.has(pkg.name) ? " (synthetic)" : "";
        console.log(`  - ${pkg.name}@${pkg.version} [${pkg.namespace}]${synLabel}`);
      }
    }
    const staging = resolvedPackages.length > 0
      ? await stageAndRelink(projectPath, resolvedPackages, syntheticPackages)
      : { staged: [], relinked: [] };
    
    if (staging.relinked.length > 0) {
      console.log(`  ↳ Re-linked ${staging.relinked.length} internal dependency(ies)`);
    }
    
    // Phase 3: Inject into local package.json only
    await injectStagedPackages(projectPath, staging.staged, removePackageNames, registryPackages, syntheticPackages);
    result.removed = removePackageNames;
    
    // Phase 4: npm install
    result.npmExitCode = await runNpmInstall(options.runScripts);
    
    if (result.npmExitCode !== 0) {
      return result;
    }
    
    // Phase 4.5: Clean broken bin symlinks + link bin entries
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
    
    // Phase 5: Tracking
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

    for (const pkg of registryPackages) {
      result.installed.push({
        name: pkg.name,
        version: pkg.version,
        qname: `${pkg.name}@${pkg.version}`,
        namespace: "registry",
      });
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
  
  // ================================================================
  // EXISTING: Direct copy to node_modules (without --npm)
  // ================================================================

  const brokenRemoved = await cleanBrokenBinLinks(projectPath);
  if (brokenRemoved > 0) {
    console.log(`  ↳ Cleaned ${brokenRemoved} broken bin symlink${brokenRemoved === 1 ? "" : "s"}`);
  }

  for (const [pkgName, spec] of Object.entries(config.packages)) {
    if (syntheticPackages.has(pkgName)) continue;
    const version = spec.version[mode];
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
  configName?: string;
  configKey?: string;
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
      configName: args.configName,
      configKey: args.configKey,
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
