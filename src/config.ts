/**
 * Config - Carga y gestión de configuración
 */

import fs from "fs/promises";
import path from "path";
import type {
  DevLinkConfig,
  FactoryContext,
  ModeConfig,
  PackageVersions,
} from "./types.js";

/**
 * Crea el contexto para las factories
 */
export function createContext(
  packages: Record<string, PackageVersions>
): FactoryContext {
  return {
    env: process.env,
    args: process.argv.slice(2),
    cwd: process.cwd(),
    packages,
  };
}

/**
 * Detecta el modo basado en la configuración o defaults
 */
export function detectMode(
  config: DevLinkConfig,
  ctx: FactoryContext
): "dev" | "prod" {
  if (config.detectMode) {
    return config.detectMode(ctx);
  }

  // Detección por defecto
  if (ctx.env.SST_LOCAL === "true") return "dev";
  if (ctx.env.NODE_ENV === "development") return "dev";
  if (ctx.args.includes("--dev")) return "dev";
  if (ctx.args.includes("--mode=dev")) return "dev";

  return "prod";
}

/**
 * Carga y normaliza la configuración
 */
export async function loadConfig(configPath: string): Promise<{
  config: DevLinkConfig;
  ctx: FactoryContext;
  mode: "dev" | "prod";
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
  if (typeof config.prod !== "function") {
    throw new Error("Configuration must have a 'prod' factory function");
  }

  // Crear contexto
  const ctx = createContext(config.packages);

  // Detectar modo
  const mode = detectMode(config, ctx);

  // Obtener configuración del modo
  const modeFactory = mode === "dev" ? config.dev : config.prod;
  const modeConfig = modeFactory(ctx);

  return { config, ctx, mode, modeConfig };
}
