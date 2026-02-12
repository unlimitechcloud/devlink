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
  PackageVersions,
  ResolvedPackage,
  PackageManifest,
  StoredPackage,
  Lockfile,
} from "./types.js";

// Config
export { loadConfig, createContext, detectMode } from "./config.js";

// Store
export {
  publishPackage,
  linkPackage,
  removePackages,
  getStoreMainDir,
  getStorePackagesDir,
  getPackageStoreDir,
  getPackageSignature,
  readPackageManifest,
  writePackageManifest,
  readLockfile,
  writeLockfile,
} from "./store.js";

// Installer
export { install, resolvePackages } from "./installer.js";
