/**
 * Config - Carga y gestión de configuración
 */

import fs from "fs/promises";
import path from "path";
import type {
  DevLinkConfig,
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
export async function loadConfig(configPath: string): Promise<{
  config: DevLinkConfig;
  ctx: FactoryContext;
  mode: string;
  modeConfig: ModeConfig;
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
  if (typeof config.dev !== "function") {
    throw new Error("Configuration must have a 'dev' factory function");
  }

  // Crear contexto
  const ctx = createContext(config.packages);

  // Detectar modo por defecto
  let mode = "dev";
  if (ctx.env.SST_LOCAL === "true") mode = "dev";
  else if (ctx.env.NODE_ENV === "development") mode = "dev";
  else if (ctx.args.includes("--dev")) mode = "dev";
  else if (ctx.args.includes("--mode=dev")) mode = "dev";

  // Obtener configuración del modo
  const modeFactory = config[mode] as ModeFactory | undefined;
  if (!modeFactory || typeof modeFactory !== "function") {
    throw new Error(`Mode "${mode}" is not defined in configuration`);
  }
  const modeConfig = modeFactory(ctx);

  return { config, ctx, mode, modeConfig };
}

/**
 * Detects if a package spec uses the new format: { version: { mode: "ver" }, synthetic?: boolean }
 */
export function isNewFormat(spec: unknown): spec is PackageSpecNew {
  return (
    typeof spec === "object" &&
    spec !== null &&
    !Array.isArray(spec) &&
    "version" in spec &&
    typeof (spec as any).version === "object" &&
    (spec as any).version !== null &&
    !Array.isArray((spec as any).version)
  );
}

/**
 * Normalizes a raw DevLinkConfig into a unified NormalizedConfig.
 *
 * Format: { version: { dev: "0.3.0" }, synthetic?: true }
 */
export function normalizeConfig(raw: DevLinkConfig): NormalizedConfig {
  const packages: Record<string, NormalizedPackageSpec> = {};

  for (const [pkgName, spec] of Object.entries(raw.packages)) {
    if (isNewFormat(spec)) {
      packages[pkgName] = {
        versions: spec.version,
        synthetic: spec.synthetic ?? false,
      };
    } else {
      throw new Error(
        `Unrecognized config format for package "${pkgName}": expected { version: { mode: "ver" } }`
      );
    }
  }

  // Extract mode factories: top-level functions excluding reserved keys
  const modes: Record<string, ModeFactory> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "packages") continue;
    if (typeof value === "function") {
      modes[key] = value as ModeFactory;
    }
  }

  return { packages, modes };
}
