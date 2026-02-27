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
  packages: Record<string, PackageSpecNew>;
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
 * 
 * Mode factories are defined as top-level properties (e.g. dev, remote, prod).
 * Mode factories are defined as top-level properties (e.g. dev, remote, prod).
 */
export interface DevLinkConfig {
  packages: Record<string, PackageSpecNew>;
  [key: string]: any;
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

// ============================================================================
// Tree Scanner Types
// ============================================================================

/**
 * Tipo de módulo inferido por heurísticas (scripts, path patterns, nombre)
 */
export type ModuleType = 'library' | 'infrastructure' | 'service' | 'app' | 'unknown';

/**
 * Módulo descubierto en el monorepo
 */
export interface MonorepoModule {
  /** Nombre del package.json */
  name: string;
  /** Ruta absoluta al módulo */
  path: string;
  /** Ruta relativa a la raíz del monorepo */
  relativePath: string;
  /** Clasificación por heurísticas */
  type: ModuleType;
  /** Tiene campo workspaces en package.json */
  hasWorkspaces: boolean;
  /** No pertenece a ningún workspace glob del padre */
  isIsolated: boolean;
  /** Nombres de scripts disponibles */
  scripts: string[];
  /** Módulos hijos (sub-paquetes de sub-monorepos) */
  children: MonorepoModule[];
}

/**
 * Nivel de instalación donde se ejecuta npm install / dev-link install.
 * Ordenados: raíz → sub-monorepos → aislados.
 */
export interface InstallLevel {
  /** Ruta absoluta */
  path: string;
  /** Ruta relativa a la raíz */
  relativePath: string;
  /** Globs de workspaces del package.json */
  workspaces: string[];
}

/**
 * Árbol completo del monorepo producido por el tree scanner
 */
export interface MonorepoTree {
  /** Ruta absoluta de la raíz */
  root: string;
  /** Módulos de primer nivel */
  modules: MonorepoModule[];
  /** Niveles ordenados para instalación */
  installLevels: InstallLevel[];
  /** Rutas absolutas de paquetes aislados */
  isolatedPackages: string[];
}

/**
 * Opciones del tree scanner
 */
export interface ScanOptions {
  /** Profundidad máxima de recursión (default: 3) */
  maxDepth?: number;
}

// ============================================================================
// Multi-Level Installer Types
// ============================================================================

/**
 * Opciones para la instalación multinivel
 */
export interface MultiLevelInstallOptions {
  /** Árbol del monorepo producido por scanTree */
  tree: MonorepoTree;
  /** Modo de instalación (ej: "dev", "remote") */
  mode: string;
  /** Ejecutar npm install */
  runNpm: boolean;
  /** Ejecutar scripts de npm */
  runScripts?: boolean;
  /** Path explícito a config (override) */
  config?: string;
  /** Config file name override (searched recursively at every level) */
  configName?: string;
  /** Key within the config export to extract DevLink config from (e.g. "devlink") */
  configKey?: string;
}

/**
 * Resultado de instalación de un nivel individual
 */
export interface LevelResult {
  /** Ruta absoluta del nivel */
  path: string;
  /** Ruta relativa a la raíz */
  relativePath: string;
  /** Si la instalación fue exitosa */
  success: boolean;
  /** Duración en milisegundos */
  duration: number;
  /** Mensaje de error si falló */
  error?: string;
}

/**
 * Resultado global de la instalación multinivel
 */
export interface MultiLevelInstallResult {
  /** Resultados por nivel */
  levels: LevelResult[];
  /** Duración total en milisegundos */
  totalDuration: number;
  /** Si todos los niveles fueron exitosos */
  success: boolean;
}
// Config Normalizer Types
// ============================================================================

/**
 * Formato nuevo de paquete en config (con version anidado y synthetic)
 */
export interface PackageSpecNew {
  /** Versiones por modo */
  version: Record<string, string>;
  /** Si es un paquete sintético (solo store, no node_modules) */
  synthetic?: boolean;
}


/**
 * Formato unificado interno después de normalización
 */
export interface NormalizedPackageSpec {
  /** Versiones por modo */
  versions: Record<string, string>;
  /** Si es un paquete sintético */
  synthetic: boolean;
}

/**
 * Configuración normalizada (formato interno unificado)
 */
export interface NormalizedConfig {
  /** Paquetes normalizados */
  packages: Record<string, NormalizedPackageSpec>;
  /** Mode factories */
  modes: Record<string, ModeFactory>;
}
