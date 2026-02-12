/**
 * Constants - Paths y valores por defecto
 */

import { homedir } from "os";
import path from "path";

// Store paths
export const STORE_DIR_NAME = ".devlink";
export const REGISTRY_FILE = "registry.json";
export const INSTALLATIONS_FILE = "installations.json";
export const LOCK_FILE = ".lock";
export const SIGNATURE_FILE = "devlink.sig";
export const IGNORE_FILE = ".devlinkignore";
export const LOCKFILE_NAME = "devlink.lock";
export const NAMESPACES_DIR = "namespaces";

// Default namespace
export const DEFAULT_NAMESPACE = "global";

// Lock options
export const DEFAULT_LOCK_TIMEOUT = 30000;      // 30 seconds
export const DEFAULT_LOCK_RETRY_INTERVAL = 100; // 100ms
export const DEFAULT_LOCK_STALE_TIME = 10000;   // 10 seconds

// Config file names (in order of priority)
export const DEFAULT_CONFIG_FILES = [
  "devlink.config.mjs",
  "devlink.config.js",
  "devlink.config.cjs",
];

// Registry version
export const REGISTRY_VERSION = "1.0.0";
export const INSTALLATIONS_VERSION = "1.0.0";

// Environment variable for custom repo path
export const DEVLINK_REPO_ENV = "DEVLINK_REPO";

/**
 * Custom repo path (set via --repo flag or DEVLINK_REPO env)
 * This allows multiple repos to coexist
 */
let customRepoPath: string | null = null;

/**
 * Set custom repo path for the current process
 */
export function setRepoPath(repoPath: string): void {
  customRepoPath = path.resolve(repoPath);
}

/**
 * Get the current repo path (custom or default)
 */
export function getRepoPath(): string | null {
  return customRepoPath;
}

/**
 * Clear custom repo path (for testing)
 */
export function clearRepoPath(): void {
  customRepoPath = null;
}

/**
 * Get the default store path (home directory)
 */
export function getDefaultStorePath(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "DevLink");
  }
  return path.join(homedir(), STORE_DIR_NAME);
}

/**
 * Get the store base path
 * Priority: 1. Custom repo path (--repo), 2. DEVLINK_REPO env, 3. Default (~/.devlink)
 */
export function getStorePath(): string {
  // 1. Custom repo path set via setRepoPath()
  if (customRepoPath) {
    return customRepoPath;
  }
  
  // 2. Environment variable
  if (process.env[DEVLINK_REPO_ENV]) {
    return path.resolve(process.env[DEVLINK_REPO_ENV]);
  }
  
  // 3. Default path
  return getDefaultStorePath();
}

/**
 * Get the namespaces directory path
 */
export function getNamespacesPath(): string {
  return path.join(getStorePath(), NAMESPACES_DIR);
}

/**
 * Get the path for a specific namespace
 */
export function getNamespacePath(namespace: string): string {
  return path.join(getNamespacesPath(), namespace);
}

/**
 * Get the path for a specific package in a namespace
 */
export function getPackagePath(
  namespace: string,
  packageName: string,
  version: string
): string {
  return path.join(getNamespacePath(namespace), packageName, version);
}

/**
 * Get the registry file path
 */
export function getRegistryPath(): string {
  return path.join(getStorePath(), REGISTRY_FILE);
}

/**
 * Get the installations file path
 */
export function getInstallationsPath(): string {
  return path.join(getStorePath(), INSTALLATIONS_FILE);
}

/**
 * Get the lock file path
 */
export function getLockPath(): string {
  return path.join(getStorePath(), LOCK_FILE);
}
