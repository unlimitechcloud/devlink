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
import { stageAndRelink, STAGING_DIR, stageFromNpm } from "../core/staging.js";
import type { StagedPackage } from "../core/staging.js";
import { normalizeConfig, resolveVersion, isNewFormat } from "../config.js";

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
  syntheticPackages?: Set<string>,
  devPackages?: Set<string>
): Promise<void> {
  const packageJsonPath = path.join(projectPath, "package.json");
  const originalContent = await fs.readFile(packageJsonPath, "utf-8");
  const manifest = JSON.parse(originalContent);
  manifest.dependencies = manifest.dependencies || {};
  manifest.devDependencies = manifest.devDependencies || {};

  for (const pkg of stagedPackages) {
    if (syntheticPackages?.has(pkg.name)) continue;
    const relativePath = path.relative(projectPath, pkg.stagingPath);
    const target = devPackages?.has(pkg.name) ? "devDependencies" : "dependencies";
    manifest[target][pkg.name] = `file:${relativePath}`;
  }

  for (const pkg of registryPackages) {
    const target = devPackages?.has(pkg.name) ? "devDependencies" : "dependencies";
    manifest[target][pkg.name] = pkg.version;
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
  linked: { name: string; linkPath: string }[];
  npmExitCode?: number;
}

/**
 * Check if a package@version exists in the npm registry.
 * Uses `npm view` which exits 0 if found, non-zero otherwise.
 */
async function checkNpmExists(packageName: string, version: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["view", `${packageName}@${version}`, "version", "--json"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
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
 * Run npm link for a local package path.
 * Resolves the link path relative to the project if not absolute.
 *
 * @param projectPath - The project root directory
 * @param packageName - The package name (for logging)
 * @param linkPath - Absolute or relative path to the local package
 * @returns 0 on success, non-zero on failure
 */
async function runNpmLink(projectPath: string, packageName: string, linkPath: string): Promise<number> {
  const resolvedPath = path.isAbsolute(linkPath) ? linkPath : path.resolve(projectPath, linkPath);
  return new Promise((resolve) => {
    const child = spawn("npm", ["link", resolvedPath], {
      cwd: projectPath,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Install packages from store based on config.
 * Operates on the current directory (root of monorepo).
 * Injects file: protocols into the local package.json only.
 */
export async function installPackages(options: InstallOptions = {}): Promise<InstallResult> {
  const projectPath = process.cwd();

  // ── Clean staging directory at the start of every run ───────────────
  // Ensures no stale packages from previous executions remain.
  const stagingDir = path.join(projectPath, STAGING_DIR);
  await fs.rm(stagingDir, { recursive: true, force: true });

  // ── No mode: npm primary, store (global) fallback ───────────────────
  if (!options.mode) {
    const result: InstallResult = { installed: [], removed: [], skipped: [], linked: [] };

    if (options.runNpm) {
      // Try to load config to find universal packages
      let universalPackages: { name: string; version: string }[] = [];
      let syntheticUniversal: { name: string; version: string }[] = [];
      let devPackages = new Set<string>();
      let linkPackages: { name: string; linkPath: string }[] = [];
      try {
        const config = await loadConfig(options.config, options.configName, options.configKey);
        const normalized = normalizeConfig(config);
        for (const [pkgName, spec] of Object.entries(config.packages)) {
          if (isNewFormat(spec) && typeof spec.version === "string") {
            // Packages with link skip staging/resolution entirely
            if (spec.link) {
              linkPackages.push({ name: pkgName, linkPath: spec.link });
              continue;
            }
            if (normalized.packages[pkgName]?.synthetic) {
              syntheticUniversal.push({ name: pkgName, version: spec.version });
            } else {
              universalPackages.push({ name: pkgName, version: spec.version });
            }
          }
        }
        // Build devPackages set from normalized config
        for (const [pkgName, spec] of Object.entries(normalized.packages)) {
          if (spec.dev) devPackages.add(pkgName);
        }
      } catch {
        // No config found — pure npm install
      }

      // Load registry for store fallback (only if we have universal packages)
      let registry: Awaited<ReturnType<typeof readRegistry>> | null = null;
      if (syntheticUniversal.length > 0 || universalPackages.length > 0) {
        try {
          registry = await readRegistry();
        } catch {
          // Store not available — no fallback possible
        }
      }

      // Stage synthetic universal packages to .devlink/
      // Primary: npm → Fallback: store (global namespace)
      if (syntheticUniversal.length > 0) {
        console.log(`\n📦 Staging ${syntheticUniversal.length} synthetic universal package(s):`);
        for (const pkg of syntheticUniversal) {
          console.log(`  - ${pkg.name}@${pkg.version} (synthetic)`);
          const staged = await stageFromNpm(projectPath, pkg.name, pkg.version);
          if (staged) {
            result.installed.push({
              name: pkg.name,
              version: pkg.version,
              qname: `${pkg.name}@${pkg.version}`,
              namespace: "npm-synthetic",
            });
          } else {
            // Fallback: try store (global namespace)
            console.log(`  ⚠️  npm failed for ${pkg.name}@${pkg.version}, trying store fallback (global)...`);
            const storeResolution = registry
              ? resolvePackage(pkg.name, pkg.version, [DEFAULT_NAMESPACE], registry)
              : null;
            if (storeResolution?.found) {
              const stagingDir = path.join(projectPath, STAGING_DIR);
              const destPath = path.join(stagingDir, pkg.name);
              await fs.mkdir(stagingDir, { recursive: true });
              await fs.rm(destPath, { recursive: true, force: true });
              await copyDir(storeResolution.path!, destPath);
              result.installed.push({
                name: pkg.name,
                version: pkg.version,
                qname: `${pkg.name}@${pkg.version}`,
                namespace: storeResolution.namespace!,
              });
              console.log(`  ✓ ${pkg.name}@${pkg.version} [${storeResolution.namespace}] (store fallback → .devlink/)`);
            } else {
              console.log(`  ⚠️  ${pkg.name}@${pkg.version} not found in npm or store`);
              result.skipped.push({ name: pkg.name, version: pkg.version, reason: "not found in npm or store (global)" });
            }
          }
        }
      }

      // Resolve non-synthetic universal packages
      // Primary: npm → Fallback: store (global namespace)
      const npmRegistry: { name: string; version: string }[] = [];
      const storeResolved: ResolvedPackage[] = [];

      if (universalPackages.length > 0) {
        console.log(`\n📡 Resolving ${universalPackages.length} universal package(s):`);
        for (const pkg of universalPackages) {
          console.log(`  - ${pkg.name}@${pkg.version}`);
          // Primary: check npm
          const existsNpm = await checkNpmExists(pkg.name, pkg.version);
          if (existsNpm) {
            npmRegistry.push(pkg);
          } else {
            // Fallback: try store (global namespace)
            console.log(`  ⚠️  ${pkg.name}@${pkg.version} not found in npm, trying store fallback (global)...`);
            const storeResolution = registry
              ? resolvePackage(pkg.name, pkg.version, [DEFAULT_NAMESPACE], registry)
              : null;
            if (storeResolution?.found) {
              storeResolved.push({
                name: pkg.name,
                version: pkg.version,
                qname: `${pkg.name}@${pkg.version}`,
                namespace: storeResolution.namespace,
                path: storeResolution.path,
                signature: storeResolution.signature,
              });
            } else {
              console.log(`  ⚠️  ${pkg.name}@${pkg.version} not found in npm or store`);
              result.skipped.push({ name: pkg.name, version: pkg.version, reason: "not found in npm or store (global)" });
            }
          }
        }
      }

      // Stage store-fallback packages to .devlink/
      if (storeResolved.length > 0) {
        console.log(`\n📦 Staging ${storeResolved.length} universal package(s) from store (fallback):`);
        for (const pkg of storeResolved) {
          console.log(`  - ${pkg.name}@${pkg.version} [${pkg.namespace}]`);
        }
        const staging = await stageAndRelink(projectPath, storeResolved);
        if (staging.relinked.length > 0) {
          console.log(`  ↳ Re-linked ${staging.relinked.length} internal dependency(ies)`);
        }
        await injectStagedPackages(projectPath, staging.staged, [], [], undefined, devPackages);
        for (const pkg of storeResolved) {
          result.installed.push(pkg);
        }
      }

      // Inject npm-resolved packages into package.json
      if (npmRegistry.length > 0) {
        console.log(`\n📡 Injecting ${npmRegistry.length} universal package(s) from npm:`);
        for (const pkg of npmRegistry) {
          console.log(`  - ${pkg.name}@${pkg.version}`);
        }
        await injectStagedPackages(projectPath, [], [], npmRegistry, undefined, devPackages);
        for (const pkg of npmRegistry) {
          result.installed.push({
            name: pkg.name,
            version: pkg.version,
            qname: `${pkg.name}@${pkg.version}`,
            namespace: "registry",
          });
        }
      }

      result.npmExitCode = await runNpmInstall(options.runScripts);

      // ── npm link: re-link packages with link attribute after npm install ──
      if (result.npmExitCode === 0 && linkPackages.length > 0) {
        console.log(`\n🔗 Linking ${linkPackages.length} local package(s):`);
        for (const pkg of linkPackages) {
          const resolvedPath = path.isAbsolute(pkg.linkPath) ? pkg.linkPath : path.resolve(projectPath, pkg.linkPath);
          console.log(`  - ${pkg.name} → ${resolvedPath}`);
          const code = await runNpmLink(projectPath, pkg.name, pkg.linkPath);
          if (code === 0) {
            result.linked.push(pkg);
          } else {
            console.log(`  ⚠️  npm link failed for ${pkg.name} (exit code ${code})`);
          }
        }
        if (result.linked.length > 0) {
          console.log(`  ✓ Linked ${result.linked.length} package(s)`);
        }
      }
    }
    return result;
  }

  const config = await loadConfig(options.config, options.configName, options.configKey);
  
  // Normalize config once at the top level
  const normalized = normalizeConfig(config);
  
  // Build synthetic packages set
  const syntheticPackages = new Set<string>();
  const devPackages = new Set<string>();
  for (const [pkgName, spec] of Object.entries(normalized.packages)) {
    if (spec.synthetic) syntheticPackages.add(pkgName);
    if (spec.dev) devPackages.add(pkgName);
  }
  if (syntheticPackages.size > 0) {
    console.log(`\n🔗 ${syntheticPackages.size} synthetic package(s) (store-only):`);
    for (const name of syntheticPackages) {
      console.log(`  - ${name}`);
    }
  }
  
  // Determine mode from CLI flag
  const mode: string = options.mode;
  
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
    return { installed: [], removed: [], skipped: [], linked: [] };
  }
  
  // Determine namespaces to search
  const namespaces = options.namespaces || modeConfig.namespaces || [DEFAULT_NAMESPACE];
  
  const result: InstallResult = {
    installed: [],
    removed: [],
    skipped: [],
    linked: [],
  };
  
  // Collect packages with link attribute (skip resolution, npm link after install)
  const linkPackagesForMode: { name: string; linkPath: string }[] = [];
  for (const [pkgName, spec] of Object.entries(config.packages)) {
    if (isNewFormat(spec) && spec.link) {
      linkPackagesForMode.push({ name: pkgName, linkPath: spec.link });
    }
  }
  
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
    
    // Build set of link package names for fast lookup
    const linkPackageNames = new Set(linkPackagesForMode.map(p => p.name));
    
    // Phase 1: Resolve all packages
    const resolvedPackages: ResolvedPackage[] = [];
    const registryPackages: { name: string; version: string }[] = [];
    const removePackageNames: string[] = [];
    for (const [pkgName, spec] of Object.entries(config.packages)) {
      // Skip packages with link — they'll be npm-linked after install
      if (linkPackageNames.has(pkgName)) continue;
      
      const version = resolveVersion(spec, mode);
      if (!version) {
        removePackageNames.push(pkgName);
        continue;
      }
      
      if (isNpmManager) {
        // npm manager: npm is primary, store is fallback
        const existsNpm = await checkNpmExists(pkgName, version);
        if (existsNpm) {
          registryPackages.push({ name: pkgName, version });
        } else {
          // Fallback: try store
          console.log(`  ⚠️  ${pkgName}@${version} not found in npm, trying store fallback (${namespaces.join(", ")})...`);
          const storeResolution = resolvePackage(pkgName, version, namespaces, registry);
          if (storeResolution.found) {
            resolvedPackages.push({
              name: pkgName,
              version,
              qname: `${pkgName}@${version}`,
              namespace: storeResolution.namespace,
              path: storeResolution.path,
              signature: storeResolution.signature,
            });
          } else {
            console.log(`  ⚠️  ${pkgName}@${version} not found in npm or store`);
            result.skipped.push({ name: pkgName, version, reason: "not found in npm or store" });
          }
        }
        continue;
      }
      
      const resolution = resolvePackage(pkgName, version, namespaces, registry);
      if (!resolution.found) {
        // store manager: fallback to npm registry when not found in store
        const existsNpm = await checkNpmExists(pkgName, version);
        if (existsNpm) {
          console.log(`  ⚠️  ${pkgName}@${version} not found in store (${namespaces.join(", ")}), falling back to npm`);
          registryPackages.push({ name: pkgName, version });
        } else {
          console.log(`  ⚠️  ${pkgName}@${version} not found in store or npm`);
          result.skipped.push({ name: pkgName, version, reason: "not found in store or npm" });
        }
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
    
    // Phase 1.5: Stage synthetic packages — npm primary, store fallback
    const syntheticFromNpm = registryPackages.filter(p => syntheticPackages.has(p.name));
    const nonSyntheticRegistry = registryPackages.filter(p => !syntheticPackages.has(p.name));
    
    if (syntheticFromNpm.length > 0) {
      console.log(`\n📦 Staging ${syntheticFromNpm.length} synthetic package(s):`);
      for (const pkg of syntheticFromNpm) {
        console.log(`  - ${pkg.name}@${pkg.version} (synthetic)`);
        if (isNpmManager) {
          // npm manager: npm primary → store fallback
          const staged = await stageFromNpm(projectPath, pkg.name, pkg.version);
          if (staged) continue;
          // Fallback: try store
          console.log(`  ⚠️  npm failed for ${pkg.name}@${pkg.version}, trying store fallback (${namespaces.join(", ")})...`);
          const storeResolution = resolvePackage(pkg.name, pkg.version, namespaces, registry);
          if (storeResolution.found) {
            const stagingDir = path.join(projectPath, STAGING_DIR);
            const destPath = path.join(stagingDir, pkg.name);
            await fs.mkdir(stagingDir, { recursive: true });
            await fs.rm(destPath, { recursive: true, force: true });
            await copyDir(storeResolution.path!, destPath);
            console.log(`  ✓ ${pkg.name}@${pkg.version} [${storeResolution.namespace}] (store fallback → .devlink/)`);
          } else {
            console.log(`  ⚠️  ${pkg.name}@${pkg.version} not found in npm or store`);
            result.skipped.push({ name: pkg.name, version: pkg.version, reason: "not found in npm or store" });
          }
        } else {
          // store manager: these already failed store resolution (fell to registryPackages)
          // npm is the fallback here
          const staged = await stageFromNpm(projectPath, pkg.name, pkg.version);
          if (!staged) {
            console.log(`  ⚠️  ${pkg.name}@${pkg.version} not found in store or npm`);
            result.skipped.push({ name: pkg.name, version: pkg.version, reason: "not found in store or npm" });
          }
        }
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
    await injectStagedPackages(projectPath, staging.staged, removePackageNames, nonSyntheticRegistry, syntheticPackages, devPackages);
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
    
    // Phase 4.6: npm link for packages with link attribute
    if (linkPackagesForMode.length > 0) {
      console.log(`\n🔗 Linking ${linkPackagesForMode.length} local package(s):`);
      for (const pkg of linkPackagesForMode) {
        const resolvedLinkPath = path.isAbsolute(pkg.linkPath) ? pkg.linkPath : path.resolve(projectPath, pkg.linkPath);
        console.log(`  - ${pkg.name} → ${resolvedLinkPath}`);
        const code = await runNpmLink(projectPath, pkg.name, pkg.linkPath);
        if (code === 0) {
          result.linked.push(pkg);
        } else {
          console.log(`  ⚠️  npm link failed for ${pkg.name} (exit code ${code})`);
        }
      }
      if (result.linked.length > 0) {
        console.log(`  ✓ Linked ${result.linked.length} package(s)`);
      }
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
    // Skip packages with link — they'll be npm-linked after the loop
    if (isNewFormat(spec) && spec.link) continue;
    
    const version = resolveVersion(spec, mode);
    if (!version) {
      result.skipped.push({ name: pkgName, version: "N/A", reason: `No ${mode} version specified` });
      continue;
    }

    const isSynthetic = syntheticPackages.has(pkgName);
    
    const resolution = resolvePackage(pkgName, version, namespaces, registry);
    if (!resolution.found) {
      if (isSynthetic) {
        // Synthetic fallback: stage from npm to .devlink/
        console.log(`  ⚠️  ${pkgName}@${version} not found in store (${namespaces.join(", ")}), staging from npm (synthetic)`);
        const staged = await stageFromNpm(projectPath, pkgName, version);
        if (staged) {
          result.installed.push({
            name: pkgName,
            version,
            qname: `${pkgName}@${version}`,
            namespace: "npm-synthetic",
          });
          console.log(`  ✓ ${pkgName}@${version} (npm synthetic staging)`);
        } else {
          result.skipped.push({ name: pkgName, version, reason: "npm synthetic staging failed" });
          console.log(`  ⚠️  Failed to stage ${pkgName}@${version} from npm`);
        }
        continue;
      }

      // Non-synthetic fallback: npm install --no-save
      console.log(`  ⚠️  ${pkgName}@${version} not found in store (${namespaces.join(", ")}), falling back to npm`);
      try {
        const exitCode = await new Promise<number>((resolve, reject) => {
          const child = spawn("npm", ["install", `${pkgName}@${version}`, "--no-save"], {
            cwd: projectPath,
            stdio: "inherit",
          });
          child.on("error", reject);
          child.on("close", (code) => resolve(code ?? 1));
        });
        if (exitCode !== 0) {
          result.skipped.push({ name: pkgName, version, reason: `npm fallback failed (exit code ${exitCode})` });
          continue;
        }
        await linkBinEntries(projectPath, pkgName);
        lockfile.packages[pkgName] = {
          version,
          signature: `npm:${version}`,
        };
        installedPackages[pkgName] = {
          version,
          namespace: "npm-fallback",
          signature: `npm:${version}`,
          installedAt: new Date().toISOString(),
        };
        result.installed.push({
          name: pkgName,
          version,
          qname: `${pkgName}@${version}`,
          namespace: "npm-fallback",
        });
        console.log(`  ✓ ${pkgName}@${version} (npm fallback)`);
      } catch (err: any) {
        result.skipped.push({ name: pkgName, version, reason: `npm fallback failed: ${err.message}` });
      }
      continue;
    }

    // Synthetic packages found in store: stage to .devlink/ (skip node_modules copy)
    if (isSynthetic) {
      const stagingDir = path.join(projectPath, STAGING_DIR);
      const destPath = path.join(stagingDir, pkgName);
      await fs.mkdir(stagingDir, { recursive: true });
      await fs.rm(destPath, { recursive: true, force: true });
      await copyDir(resolution.path!, destPath);
      result.installed.push({
        name: pkgName,
        version,
        qname: `${pkgName}@${version}`,
        namespace: resolution.namespace!,
      });
      console.log(`  ✓ ${pkgName}@${version} [${resolution.namespace}] (synthetic → .devlink/)`);
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
  
  // ── npm link for packages with link attribute (direct copy flow) ─────
  if (linkPackagesForMode.length > 0) {
    console.log(`\n🔗 Linking ${linkPackagesForMode.length} local package(s):`);
    for (const pkg of linkPackagesForMode) {
      const resolvedLinkPath = path.isAbsolute(pkg.linkPath) ? pkg.linkPath : path.resolve(projectPath, pkg.linkPath);
      console.log(`  - ${pkg.name} → ${resolvedLinkPath}`);
      const code = await runNpmLink(projectPath, pkg.name, pkg.linkPath);
      if (code === 0) {
        result.linked.push(pkg);
      } else {
        console.log(`  ⚠️  npm link failed for ${pkg.name} (exit code ${code})`);
      }
    }
    if (result.linked.length > 0) {
      console.log(`  ✓ Linked ${result.linked.length} package(s)`);
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

    if (result.linked && result.linked.length > 0) {
      console.log(`\n✓ Linked ${result.linked.length} local package(s):`);
      for (const pkg of result.linked) {
        console.log(`  - ${pkg.name} → ${pkg.linkPath}`);
      }
    }
    
    if (args.npm) {
      if (result.npmExitCode === 0) {
        console.log("\n✓ npm install completed successfully");
      } else {
        console.error(`\n✗ npm install failed with exit code ${result.npmExitCode}`);
        process.exit(result.npmExitCode || 1);
      }
    }

    // Exit with error if any packages were skipped (resolution failures)
    if (result.skipped.length > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`✗ Install failed: ${error.message}`);
    process.exit(1);
  }
}
