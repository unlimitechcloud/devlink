/**
 * Plan Resolver — Resolves configuration and package registry to produce an installation plan.
 *
 * Pure computation with no filesystem mutations beyond reading config and registry files.
 * Classifies every configured package into exactly one bucket: store, registry, link,
 * remove, or skipped. Resolution priority depends on the mode's manager setting:
 * - manager: "store" → check store first, fallback to npm
 * - manager: "npm" → check npm first, fallback to store
 *
 * Link packages bypass resolution entirely. Packages with no version for the current
 * mode go to the remove bucket. The --packages filter restricts which packages are processed.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type {
  DevLinkConfig,
  DevLinkConfigV2,
  ModeConfig,
  ModeFactory,
  NormalizedConfig,
  PackageSpecNew,
  Registry,
} from "../types.js";
import { readRegistry } from "../core/registry.js";
import { resolvePackage } from "../core/resolver.js";
import { DEFAULT_NAMESPACE, DEFAULT_CONFIG_FILES } from "../constants.js";
import {
  resolveMode,
  hasModesObject,
  normalizeConfig,
  resolveVersion,
  isNewFormat,
  createContext,
} from "../config.js";
import type {
  PlanOptions,
  PlanOutput,
  PlanPackageEntry,
  PlanLinkEntry,
  PlanSkippedEntry,
} from "./types.js";

// ============================================================================
// Dependency Injection Interface (for testability)
// ============================================================================

/**
 * Injectable dependencies for the plan resolver.
 *
 * Allows unit tests to provide mock implementations of external I/O
 * (config loading, registry reading, npm checks) without touching the filesystem.
 */
export interface PlanDeps {
  loadConfig: (
    configPath?: string,
    configName?: string,
    configKey?: string
  ) => Promise<DevLinkConfig | DevLinkConfigV2>;
  readRegistry: () => Promise<Registry>;
  checkNpmExists: (packageName: string, version: string) => Promise<boolean>;
}

// ============================================================================
// Config Loading (reused pattern from src/commands/install.ts)
// ============================================================================

/**
 * Loads a DevLink configuration file from disk.
 *
 * Searches for config files in priority order: explicit path > configName > defaults.
 * Supports extracting a sub-key from the config export (e.g. "devlink").
 *
 * @param configPath - Explicit path to config file (--config flag)
 * @param configName - Config file name override (--config-name flag)
 * @param configKey - Key within the config export to extract DevLink config from
 */
async function loadConfig(
  configPath?: string,
  configName?: string,
  configKey?: string
): Promise<DevLinkConfig | DevLinkConfigV2> {
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

  const searched = configName ? [configName] : [...DEFAULT_CONFIG_FILES];
  throw new Error(
    `No configuration file found. Looked for: ${searched.join(", ")}`
  );
}

// ============================================================================
// npm Registry Check
// ============================================================================

/**
 * Checks if a package@version exists in the npm registry.
 *
 * Uses `npm view` which exits 0 if found, non-zero otherwise.
 * This is a read-only operation — no filesystem mutations.
 */
export async function checkNpmExists(
  packageName: string,
  version: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "npm",
      ["view", `${packageName}@${version}`, "version", "--json"],
      { stdio: ["ignore", "ignore", "ignore"] }
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

// ============================================================================
// Plan Execution
// ============================================================================

/**
 * Resolves the version for a package given the current mode.
 *
 * Handles both per-mode versions (Record) and universal versions (string).
 * When the normalized spec has a "*" key (universal version), it applies to all modes.
 */
function resolveVersionForMode(
  spec: PackageSpecNew,
  mode: string
): string | undefined {
  return resolveVersion(spec, mode);
}

/**
 * Executes the plan command — resolves all packages and classifies them into buckets.
 *
 * This is the entry point for the plan pipeline stage. It loads config, resolves the
 * mode, reads the store registry, and classifies each package into exactly one bucket.
 *
 * @param options - Plan command options (config path, mode, namespaces, packages filter)
 * @returns Structured PlanOutput with all packages classified
 */
export async function executePlan(options: PlanOptions = {}): Promise<PlanOutput> {
  return executePlanWithDeps(options, {
    loadConfig,
    readRegistry,
    checkNpmExists,
  });
}

/**
 * Testable version of executePlan that accepts injected dependencies.
 *
 * This function contains the core plan resolution logic. The public `executePlan`
 * delegates to this with real implementations; tests can inject mocks.
 *
 * @param options - Plan command options
 * @param deps - Injectable dependencies (config loader, registry reader, npm checker)
 * @returns Structured PlanOutput with all packages classified
 */
export async function executePlanWithDeps(
  options: PlanOptions = {},
  deps: PlanDeps
): Promise<PlanOutput> {
  const projectPath = process.cwd();

  // 1. Load configuration
  const config = await deps.loadConfig(options.config, options.configName, options.configKey);

  // 1b. Merge packagesOverride into config.packages (key-level override)
  if (options.packagesOverride) {
    if (!config.packages) {
      (config as any).packages = {};
    }
    for (const [name, spec] of Object.entries(options.packagesOverride)) {
      config.packages[name] = spec as any;
    }
  }

  // 2. Resolve mode
  let mode: string;
  let modeConfig: ModeConfig;
  let namespaces: string[];

  const hasModes = hasModesObject(config);

  // Handle the "no mode" case: universal packages with string versions
  // When no mode is specified and no modes.default exists (legacy without modes object),
  // we use "npm" as the default manager and process universal packages
  if (!options.mode && !hasModes) {
    mode = "__universal__";
    modeConfig = { manager: "npm" };
    namespaces = options.namespaces || [DEFAULT_NAMESPACE];
  } else {
    // Normal mode resolution (V2 or legacy with explicit mode)
    mode = resolveMode(config, options.mode);

    // Get mode factory and execute it
    const factory = hasModes
      ? (config as DevLinkConfigV2).modes[mode] as ModeFactory
      : (config as any)[mode] as ModeFactory;

    const ctx = createContext(config.packages);
    modeConfig = factory(ctx);
    namespaces = options.namespaces || modeConfig.namespaces || [DEFAULT_NAMESPACE];
  }

  // 3. Load store registry
  const registry = await deps.readRegistry();

  // 4. Build package filter
  const packageFilter = options.packages?.length
    ? new Set(options.packages)
    : null;

  // Validate that filtered packages exist in config
  if (packageFilter) {
    for (const name of packageFilter) {
      if (!config.packages[name]) {
        throw new Error(
          `Package "${name}" is not defined in the configuration`
        );
      }
    }
  }

  // 5. Classify packages into buckets
  const packages = await resolvePackages(
    config,
    mode,
    modeConfig,
    namespaces,
    registry,
    packageFilter,
    deps.checkNpmExists
  );

  return {
    version: "1",
    mode: mode === "__universal__" ? "" : mode,
    manager: modeConfig.manager,
    namespaces,
    projectPath,
    packages,
  };
}

/**
 * Resolves all packages in config against store and npm registries,
 * classifying each into the appropriate bucket.
 *
 * Loop invariant: at each iteration, the package being processed is not yet in any
 * bucket. After each iteration, the package is in exactly one bucket.
 */
async function resolvePackages(
  config: DevLinkConfig | DevLinkConfigV2,
  mode: string,
  modeConfig: ModeConfig,
  namespaces: string[],
  registry: Registry,
  packageFilter: Set<string> | null,
  checkNpmExistsFn: (packageName: string, version: string) => Promise<boolean>
): Promise<PlanOutput["packages"]> {
  const result: PlanOutput["packages"] = {
    store: [],
    registry: [],
    link: [],
    remove: [],
    skipped: [],
  };

  for (const [pkgName, spec] of Object.entries(config.packages)) {
    // Skip if not in filter (when filter is active)
    if (packageFilter && !packageFilter.has(pkgName)) continue;

    // Validate spec format
    if (!isNewFormat(spec)) {
      result.skipped.push({
        name: pkgName,
        version: "",
        reason: "unrecognized config format",
      });
      continue;
    }

    // Link packages bypass resolution entirely
    if (spec.link) {
      const version = resolveVersionForMode(spec, mode) ?? "";
      result.link.push({
        name: pkgName,
        version,
        path: spec.link,
        dev: spec.dev ?? false,
      });
      continue;
    }

    // Resolve version for current mode
    const version = resolveVersionForMode(spec, mode);
    if (!version) {
      result.remove.push(pkgName);
      continue;
    }

    // Extract metadata flags from spec
    const synthetic = spec.synthetic ?? false;
    const dev = spec.dev ?? false;

    // Resolution strategy depends on manager
    if (modeConfig.manager === "store") {
      await resolveStoreFirst(
        pkgName,
        version,
        namespaces,
        registry,
        result,
        checkNpmExistsFn,
        synthetic,
        dev
      );
    } else {
      await resolveNpmFirst(
        pkgName,
        version,
        namespaces,
        registry,
        result,
        checkNpmExistsFn,
        synthetic,
        dev
      );
    }
  }

  return result;
}

/**
 * Store-first resolution: check store registry, fallback to npm.
 */
async function resolveStoreFirst(
  pkgName: string,
  version: string,
  namespaces: string[],
  registry: Registry,
  result: PlanOutput["packages"],
  checkNpmExistsFn: (packageName: string, version: string) => Promise<boolean>,
  synthetic: boolean,
  dev: boolean
): Promise<void> {
  const storeResult = resolvePackage(pkgName, version, namespaces, registry);
  if (storeResult.found) {
    result.store.push({
      name: pkgName,
      version,
      namespace: storeResult.namespace!,
      path: storeResult.path!,
      ...(synthetic ? { synthetic: true } : {}),
      ...(dev ? { dev: true } : {}),
    });
    return;
  }

  // Fallback: check npm
  const npmExists = await checkNpmExistsFn(pkgName, version);
  if (npmExists) {
    result.registry.push({
      name: pkgName,
      version,
      namespace: "npm",
      path: "",
      ...(synthetic ? { synthetic: true } : {}),
      ...(dev ? { dev: true } : {}),
    });
    return;
  }

  result.skipped.push({
    name: pkgName,
    version,
    reason: "not found in store or npm",
  });
}

/**
 * Npm-first resolution: check npm registry, fallback to store.
 */
async function resolveNpmFirst(
  pkgName: string,
  version: string,
  namespaces: string[],
  registry: Registry,
  result: PlanOutput["packages"],
  checkNpmExistsFn: (packageName: string, version: string) => Promise<boolean>,
  synthetic: boolean,
  dev: boolean
): Promise<void> {
  const npmExists = await checkNpmExistsFn(pkgName, version);
  if (npmExists) {
    result.registry.push({
      name: pkgName,
      version,
      namespace: "npm",
      path: "",
      ...(synthetic ? { synthetic: true } : {}),
      ...(dev ? { dev: true } : {}),
    });
    return;
  }

  // Fallback: check store
  const storeResult = resolvePackage(pkgName, version, namespaces, registry);
  if (storeResult.found) {
    result.store.push({
      name: pkgName,
      version,
      namespace: storeResult.namespace!,
      path: storeResult.path!,
      ...(synthetic ? { synthetic: true } : {}),
      ...(dev ? { dev: true } : {}),
    });
    return;
  }

  result.skipped.push({
    name: pkgName,
    version,
    reason: "not found in npm or store",
  });
}
