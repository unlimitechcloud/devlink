/**
 * @unlimitechcloud/devlink
 * 
 * Local package development and linking tool
 * with declarative configuration and namespace support
 */

// Types
export type {
  DevLinkConfig,
  ModeConfig,
  ModeFactory,
  FactoryContext,
  ResolvedPackage,
  PackageManifest,
  StoredPackage,
  Lockfile,
  MonorepoTree,
  MonorepoModule,
  InstallLevel,
  ScanOptions,
  MultiLevelInstallOptions,
  MultiLevelInstallResult,
  LevelResult,
  NormalizedConfig,
  NormalizedPackageSpec,
  PackageSpecNew,
} from "./types.js";

// Config
export { loadConfig, createContext, normalizeConfig } from "./config.js";

// Core
export { scanTree, classifyModule } from "./core/tree.js";
export { installMultiLevel, runNpmAtLevel } from "./core/multilevel.js";
export { stageAndRelink, STAGING_DIR } from "./core/staging.js";
export { resolvePackage } from "./core/resolver.js";

// Commands
export { installPackages, handleInstall } from "./commands/install.js";
export { handleTree } from "./commands/tree.js";
