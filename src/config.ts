/**
 * Config — Configuration loading, normalization, and mode resolution.
 *
 * Supports two config formats:
 * - Legacy: mode factories as top-level properties (e.g. `dev`, `remote`)
 * - V2: structured `modes` object with a reserved `default` key
 *
 * The `resolveMode` function handles both formats transparently.
 */

import fs from "fs/promises";
import path from "path";
import type {
  DevLinkConfig,
  DevLinkConfigV2,
  FactoryContext,
  ModeConfig,
  ModeFactory,
  NormalizedConfig,
  NormalizedPackageSpec,
  PackageSpecNew,
} from "./types.js";

/**
 * Crea el contexto para las factories
 */
export function createContext(
  packages: Record<string, PackageSpecNew>
): FactoryContext {
  return {
    env: process.env,
    args: process.argv.slice(2),
    cwd: process.cwd(),
    packages,
  };
}

/**
 * Carga y normaliza la configuración
 */
export async function loadConfig(configPath: string, mode?: string): Promise<{
  config: DevLinkConfig;
  ctx: FactoryContext;
  mode: string | undefined;
  modeConfig: ModeConfig | undefined;
}> {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  try {
    await fs.access(absolutePath);
  } catch {
    throw new Error(`Configuration file not found: ${absolutePath}`);
  }

  // Importar configuración (soporta .mjs, .cjs, .js)
  const imported = await import(absolutePath);
  const config: DevLinkConfig = imported.default || imported;

  // Validar configuración
  if (!config.packages || typeof config.packages !== "object") {
    throw new Error("Configuration must have a 'packages' object");
  }

  // Crear contexto
  const ctx = createContext(config.packages);

  // When no mode is specified, return config without mode resolution
  if (!mode) {
    return { config, ctx, mode: undefined, modeConfig: undefined };
  }

  // Obtener configuración del modo
  const modeFactory = config[mode] as ModeFactory | undefined;
  if (!modeFactory || typeof modeFactory !== "function") {
    throw new Error(`Mode "${mode}" is not defined in configuration`);
  }
  const modeConfig = modeFactory(ctx);

  return { config, ctx, mode, modeConfig };
}

/**
 * Detects if a package spec uses the new format: { version: "ver" | { mode: "ver" }, synthetic?: boolean }
 */
export function isNewFormat(spec: unknown): spec is PackageSpecNew {
  if (
    typeof spec !== "object" ||
    spec === null ||
    Array.isArray(spec) ||
    !("version" in spec)
  ) {
    return false;
  }
  const v = (spec as any).version;
  // version can be a string (universal) or a non-null, non-array object (per-mode)
  return (
    typeof v === "string" ||
    (typeof v === "object" && v !== null && !Array.isArray(v))
  );
}

/**
 * Resolves the version for a given mode from a PackageSpecNew.
 *
 * - If `spec.version` is a string (universal), returns that string for any mode.
 * - If `spec.version` is a Record, returns `spec.version[mode]` (may be undefined).
 */
export function resolveVersion(spec: PackageSpecNew, mode: string): string | undefined {
  if (typeof spec.version === "string") {
    return spec.version;
  }
  return spec.version[mode];
}

/**
 * Normalizes a raw DevLinkConfig into a unified NormalizedConfig.
 *
 * Format: { version: { dev: "0.3.0" }, synthetic?: true }
 * Or:     { version: "0.3.0", synthetic?: true }  (universal — all modes)
 *
 * Supports both legacy (top-level mode factories) and V2 (modes object) formats.
 */
export function normalizeConfig(raw: DevLinkConfig | DevLinkConfigV2): NormalizedConfig {
  const packages: Record<string, NormalizedPackageSpec> = {};

  for (const [pkgName, spec] of Object.entries(raw.packages)) {
    if (isNewFormat(spec)) {
      const versions = typeof spec.version === "string"
        ? { "*": spec.version }
        : spec.version;
      packages[pkgName] = {
        versions,
        synthetic: spec.synthetic ?? false,
        dev: spec.dev ?? false,
        ...(spec.link ? { link: spec.link } : {}),
      };
    } else {
      throw new Error(
        `Unrecognized config format for package "${pkgName}": expected { version: "ver" } or { version: { mode: "ver" } }`
      );
    }
  }

  // Extract mode factories depending on config format
  const modes: Record<string, ModeFactory> = {};

  if (hasModesObject(raw)) {
    // V2 format: extract factories from modes object
    for (const [key, value] of Object.entries(raw.modes)) {
      if (key === "default") continue;
      if (typeof value === "function") {
        modes[key] = value as ModeFactory;
      }
    }
  } else {
    // Legacy format: top-level functions excluding reserved keys
    for (const [key, value] of Object.entries(raw)) {
      if (key === "packages") continue;
      if (typeof value === "function") {
        modes[key] = value as ModeFactory;
      }
    }
  }

  return { packages, modes };
}

/**
 * Detects whether a config uses the V2 `modes` object format.
 *
 * A config has the V2 format when it contains a `modes` property that is
 * a non-null object (not an array).
 */
export function hasModesObject(config: DevLinkConfig | DevLinkConfigV2): config is DevLinkConfigV2 {
  return (
    "modes" in config &&
    typeof (config as any).modes === "object" &&
    (config as any).modes !== null &&
    !Array.isArray((config as any).modes)
  );
}

/**
 * Validates the `modes` object in a V2 config.
 *
 * Checks:
 * - `modes.default` is a string
 * - `modes.default` references an existing mode key
 * - Each non-`default` entry is a callable function (ModeFactory)
 *
 * @throws Error with descriptive message if validation fails
 */
export function validateModesObject(config: DevLinkConfigV2): void {
  const { modes } = config;

  // Validate modes.default is a string
  if (typeof modes.default !== "string" || modes.default.trim() === "") {
    throw new Error(
      `"modes.default" must be a non-empty string referencing a mode name`
    );
  }

  // Collect available mode names (non-default entries that are functions)
  const availableModes: string[] = [];
  for (const [key, value] of Object.entries(modes)) {
    if (key === "default") continue;
    if (typeof value !== "function") {
      throw new Error(
        `Mode "${key}" must be a function (ModeFactory), got ${typeof value}`
      );
    }
    availableModes.push(key);
  }

  // Validate modes.default references an existing mode
  if (!availableModes.includes(modes.default)) {
    throw new Error(
      `"modes.default" references "${modes.default}" which does not exist in modes. Available modes: ${availableModes.join(", ")}`
    );
  }
}

/**
 * Resolves the effective mode name from a config.
 *
 * Supports both V2 (modes object) and legacy (top-level factories) formats:
 * - V2: returns explicitMode if provided, otherwise modes.default
 * - Legacy: returns explicitMode if provided, otherwise throws (no default available)
 *
 * Validates that the resolved mode has a corresponding factory.
 *
 * @param config - The raw config (V2 or legacy)
 * @param explicitMode - Optional explicit mode from --mode flag
 * @returns The resolved mode name
 * @throws Error if mode cannot be resolved or doesn't have a factory
 */
export function resolveMode(config: DevLinkConfig | DevLinkConfigV2, explicitMode?: string): string {
  if (hasModesObject(config)) {
    // V2 format: validate the modes object first
    validateModesObject(config);

    const resolvedMode = explicitMode ?? config.modes.default;

    // Validate the resolved mode has a factory
    const factory = config.modes[resolvedMode];
    if (typeof factory !== "function") {
      const availableModes = Object.keys(config.modes).filter(
        (k) => k !== "default" && typeof config.modes[k] === "function"
      );
      throw new Error(
        `Mode "${resolvedMode}" is not defined in modes. Available modes: ${availableModes.join(", ")}`
      );
    }

    return resolvedMode;
  }

  // Legacy format: top-level mode factories
  if (explicitMode) {
    // Validate the explicit mode exists as a top-level function
    if (typeof (config as any)[explicitMode] !== "function") {
      const availableModes = Object.keys(config)
        .filter((k) => k !== "packages" && typeof (config as any)[k] === "function");
      throw new Error(
        `Mode "${explicitMode}" is not defined in configuration. Available modes: ${availableModes.join(", ")}`
      );
    }
    return explicitMode;
  }

  // Legacy format without explicit mode: no default available
  throw new Error(
    `No --mode flag provided and no "modes.default" configured. Either provide --mode or add a modes object with a default key to your config.`
  );
}
