/**
 * Types - Definiciones de tipos para DevLink
 */

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Registry principal del store
 */
export interface Registry {
  version: string;
  namespaces: Record<string, NamespaceEntry>;
}

/**
 * Entrada de un namespace en el registry
 */
export interface NamespaceEntry {
  created: string;
  packages: Record<string, PackageEntry>;
}

/**
 * Entrada de un paquete en el registry
 */
export interface PackageEntry {
  versions: Record<string, VersionEntry>;
}

/**
 * Entrada de una versión en el registry
 */
export interface VersionEntry {
  signature: string;
  published: string;
  files: number;
}

// ============================================================================
// Installations Types
// ============================================================================

/**
 * Tracking de instalaciones
 */
export interface Installations {
  version: string;
  projects: Record<string, ProjectEntry>;
}

/**
 * Entrada de un proyecto en installations
 */
export interface ProjectEntry {
  registered: string;
  packages: Record<string, InstalledPackage>;
}

/**
 * Información de un paquete instalado en un proyecto
 */
export interface InstalledPackage {
  version: string;
  namespace: string;
  signature: string;
  installedAt: string;
}

// ============================================================================
// Lock Types
// ============================================================================

/**
 * Información del lock file
 */
export interface LockInfo {
  pid: number;
  acquired: string;
  command: string;
}

/**
 * Opciones para adquirir lock
 */
export interface LockOptions {
  timeout: number;
  retryInterval: number;
  stale: number;
}

/**
 * Handle de un lock adquirido
 */
export interface LockHandle {
  fd: number;
  release: () => Promise<void>;
}

// ============================================================================
// Resolution Types
// ============================================================================

/**
 * Resultado de resolución de un paquete
 */
export interface ResolutionResult {
  package: string;
  version: string;
  found: boolean;
  namespace?: string;
  path?: string;
  signature?: string;
  searchedNamespaces: string[];
}

// ============================================================================
// Config Types
// ============================================================================

/**
 * Contexto disponible para las factories
 */
export interface FactoryContext {
  env: NodeJS.ProcessEnv;
  args: string[];
  cwd: string;
  packages: Record<string, PackageVersions>;
}

/**
 * Versiones por modo para un paquete
 */
export interface PackageVersions {
  dev?: string;
  prod?: string;
}

/**
 * Información de un paquete resuelto para instalación
 */
export interface ResolvedPackage {
  name: string;
  version: string;
  qname: string;
  namespace?: string;
  path?: string;
  signature?: string;
}

/**
 * Configuración de modo retornada por factory
 */
export interface ModeConfig {
  manager: "store" | "npm";
  namespaces?: string[];
  args?: string[];
  /** @deprecated Use namespaces instead */
  storeFolder?: string;
  /**
   * Glob patterns for packages whose dependencies should be marked as optional peerDependencies.
   * When DevLink copies a package to node_modules, it will convert matching dependencies
   * to peerDependencies with optional:true in peerDependenciesMeta.
   * This prevents npm from trying to resolve them from the registry.
   * Example: ["@webforgeai/*"] marks all @webforgeai packages as optional peers.
   */
  peerOptional?: string[];
  beforeAll?: () => Promise<void> | void;
  afterAll?: () => Promise<void> | void;
  beforeEach?: (pkg: ResolvedPackage) => Promise<void> | void;
  afterEach?: (pkg: ResolvedPackage) => Promise<void> | void;
}

/**
 * Factory de modo
 */
export type ModeFactory = (ctx: FactoryContext) => ModeConfig;

/**
 * Configuración completa del archivo devlink.config.mjs
 */
export interface DevLinkConfig {
  packages: Record<string, PackageVersions>;
  dev: ModeFactory;
  prod: ModeFactory;
  detectMode?: (ctx: FactoryContext) => "dev" | "prod";
}

// ============================================================================
// Package Types
// ============================================================================

/**
 * Manifest de un paquete (package.json)
 */
export interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  files?: string[];
  main?: string;
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

/**
 * Información de un paquete publicado
 */
export interface StoredPackage {
  name: string;
  version: string;
  namespace: string;
  signature: string;
  path: string;
  files: number;
}

/**
 * Resultado de publicación
 */
export interface PublishResult {
  name: string;
  version: string;
  namespace: string;
  signature: string;
  path: string;
  files: number;
}

/**
 * Resultado de push
 */
export interface PushResult extends PublishResult {
  updatedProjects: string[];
  skippedProjects: string[];
}

// ============================================================================
// Lockfile Types (proyecto cliente)
// ============================================================================

/**
 * Entrada en el lockfile del proyecto
 */
export interface LockfileEntry {
  version: string;
  signature: string;
  namespace?: string;
}

/**
 * Lockfile de un proyecto cliente
 */
export interface Lockfile {
  packages: Record<string, LockfileEntry>;
}

// ============================================================================
// CLI Types
// ============================================================================

/**
 * Argumentos parseados del CLI
 */
export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: {
    namespace?: string;
    namespaces?: string[];
    packages?: string[];
    flat?: boolean;
    fix?: boolean;
    dryRun?: boolean;
    dev?: boolean;
    prod?: boolean;
    prune?: boolean;
    all?: boolean;
    help?: boolean;
  };
}

/**
 * Consumer info para comando consumers
 */
export interface ConsumerInfo {
  projectPath: string;
  registered: string;
  packages: {
    name: string;
    version: string;
    namespace: string;
    signature: string;
  }[];
}
