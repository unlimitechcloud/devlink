/**
 * Pipeline Types — Type definitions for the DevLink install pipeline.
 *
 * Defines all input/output interfaces for the composable pipeline commands:
 * plan, stage, inject, npm-install, link, hydrate, apply, and install.
 * Each command produces structured JSON output that can be consumed by
 * downstream commands or external tools.
 */

// ============================================================================
// Plan Command Types
// ============================================================================

/**
 * Options accepted by the plan command.
 */
export interface PlanOptions {
  config?: string;
  configName?: string;
  configKey?: string;
  mode?: string;
  namespaces?: string[];
  packages?: string[];
  json?: boolean;
  /**
   * Additional packages to merge into the config-declared packages.
   * Keys override config-declared packages at the key level.
   * Used by external tools (e.g. wfai CLI) to inject SDK packages dynamically.
   */
  packagesOverride?: Record<string, PackageSpecOverride>;
}

/**
 * Package spec for the --packages override parameter.
 * Matches PackageSpecNew shape but all fields are optional except version.
 */
export interface PackageSpecOverride {
  version: string | Record<string, string>;
  synthetic?: boolean;
  dev?: boolean;
  link?: string;
}

/**
 * Structured output of the plan command.
 *
 * Classifies every configured package into exactly one bucket:
 * store, registry, link, remove, or skipped.
 */
export interface PlanOutput {
  version: "1";
  mode: string;
  manager: "store" | "npm";
  namespaces: string[];
  projectPath: string;
  packages: {
    store: PlanPackageEntry[];
    registry: PlanPackageEntry[];
    link: PlanLinkEntry[];
    remove: string[];
    skipped: PlanSkippedEntry[];
  };
}

/**
 * A package resolved from the store or npm registry.
 */
export interface PlanPackageEntry {
  name: string;
  version: string;
  namespace: string;
  path: string;
  /** When true, the package is staged in .devlink/ but not injected into package.json */
  synthetic?: boolean;
  /** When true, the package is placed in devDependencies instead of dependencies */
  dev?: boolean;
}

/**
 * A package resolved via npm link (local path).
 */
export interface PlanLinkEntry {
  name: string;
  version: string;
  path: string;
  dev: boolean;
}

/**
 * A package that could not be resolved and was skipped.
 */
export interface PlanSkippedEntry {
  name: string;
  version: string;
  reason: string;
}

// ============================================================================
// Stage Command Types
// ============================================================================

/**
 * Options accepted by the stage command.
 */
export interface StageOptions {
  plan?: string;
  /** Plan data passed directly (for programmatic use, bypasses file/stdin reading) */
  planData?: PlanOutput;
  projectPath?: string;
  json?: boolean;
}

/**
 * Structured output of the stage command.
 *
 * Lists packages copied to the .devlink/ staging directory
 * and internal dependencies rewritten to file: protocols.
 */
export interface StageOutput {
  projectPath: string;
  stagingDir: string;
  staged: StagedEntry[];
  relinked: RelinkEntry[];
}

/**
 * A package staged in the .devlink/ directory.
 */
export interface StagedEntry {
  name: string;
  version: string;
  path: string;
}

/**
 * A dependency rewritten to a file: protocol reference between staged packages.
 */
export interface RelinkEntry {
  package: string;
  dep: string;
  from: string;
  to: string;
}

// ============================================================================
// Inject Command Types
// ============================================================================

/**
 * Options accepted by the inject command.
 */
export interface InjectOptions {
  stage?: string;
  plan?: string;
  /** Stage data passed directly (for programmatic use) */
  stageData?: StageOutput;
  /** Plan data passed directly (for programmatic use) */
  planData?: PlanOutput;
  projectPath?: string;
  json?: boolean;
}

/**
 * Structured output of the inject command.
 *
 * Describes modifications made to the project's package.json:
 * file: entries for staged packages, version entries for registry packages,
 * and removals for packages no longer needed.
 */
export interface InjectOutput {
  projectPath: string;
  modified: string;
  injected: InjectedEntry[];
  registry: RegistryEntry[];
  removed: string[];
  synthetic: string[];
}

/**
 * A staged package injected into package.json with a file: protocol reference.
 */
export interface InjectedEntry {
  name: string;
  target: "dependencies" | "devDependencies";
  value: string;
}

/**
 * A registry package injected into package.json with a version string.
 */
export interface RegistryEntry {
  name: string;
  target: "dependencies" | "devDependencies";
  value: string;
}

// ============================================================================
// NpmInstall Command Types
// ============================================================================

/**
 * Options accepted by the npm-install command.
 */
export interface NpmInstallOptions {
  projectPath?: string;
  ignoreScripts?: boolean;
  json?: boolean;
}

/**
 * Structured output of the npm-install command.
 *
 * Reports the exit code and arguments used for the npm install subprocess.
 */
export interface NpmInstallOutput {
  projectPath: string;
  exitCode: number;
  args: string[];
}

// ============================================================================
// Link Command Types
// ============================================================================

/**
 * Options accepted by the link command.
 */
export interface LinkOptions {
  plan?: string;
  /** Plan data passed directly (for programmatic use) */
  planData?: PlanOutput;
  projectPath?: string;
  json?: boolean;
}

/**
 * Structured output of the link command.
 *
 * Reports successful and failed npm link operations.
 */
export interface LinkOutput {
  projectPath: string;
  linked: LinkedEntry[];
  failed: FailedLinkEntry[];
}

/**
 * A package successfully linked via npm link.
 */
export interface LinkedEntry {
  name: string;
  path: string;
}

/**
 * A package that failed to link via npm link.
 */
export interface FailedLinkEntry {
  name: string;
  path: string;
  exitCode: number;
}

// ============================================================================
// Hydrate Command Types (Composite: npm-install → link)
// ============================================================================

/**
 * Options accepted by the hydrate command.
 */
export interface HydrateOptions {
  plan?: string;
  /** Plan data passed directly (for programmatic use) */
  planData?: PlanOutput;
  projectPath?: string;
  ignoreScripts?: boolean;
  json?: boolean;
}

/**
 * Structured output of the hydrate composite command.
 *
 * Orchestrates npm-install → link and collects a trace of sub-command outputs.
 */
export interface HydrateOutput {
  projectPath: string;
  success: boolean;
  trace: {
    "npm-install": NpmInstallOutput;
    link: LinkOutput;
  };
}

// ============================================================================
// Apply Command Types (Composite: inject → hydrate)
// ============================================================================

/**
 * Options accepted by the apply command.
 */
export interface ApplyOptions {
  stage?: string;
  plan?: string;
  /** Stage data passed directly (for programmatic use) */
  stageData?: StageOutput;
  /** Plan data passed directly (for programmatic use) */
  planData?: PlanOutput;
  projectPath?: string;
  ignoreScripts?: boolean;
  json?: boolean;
}

/**
 * Structured output of the apply composite command.
 *
 * Orchestrates inject → hydrate and collects a trace of sub-command outputs.
 */
export interface ApplyOutput {
  projectPath: string;
  success: boolean;
  trace: {
    inject: InjectOutput;
    hydrate: HydrateOutput;
  };
}

// ============================================================================
// Install Command Types (Full Composite: plan → stage → apply)
// ============================================================================

/**
 * Options accepted by the install command (full pipeline orchestrator).
 */
export interface InstallOptions {
  config?: string;
  configName?: string;
  configKey?: string;
  mode?: string;
  namespaces?: string[];
  packages?: string[];
  packagesOverride?: Record<string, PackageSpecOverride>;
  ignoreScripts?: boolean;
  json?: boolean;
  recursive?: boolean;
}

/**
 * Structured output of the install composite command.
 *
 * Orchestrates plan → stage → apply and collects a recursive trace
 * of all sub-command outputs.
 */
export interface InstallOutput {
  projectPath: string;
  success: boolean;
  trace: {
    plan: PlanOutput;
    stage: StageOutput;
    apply: ApplyOutput;
  };
}

// ============================================================================
// Recursive Install Types
// ============================================================================

/**
 * Options accepted by the recursive install command.
 */
export interface RecursiveInstallOptions {
  config?: string;
  configName?: string;
  configKey?: string;
  mode?: string;
  namespaces?: string[];
  packages?: string[];
  packagesOverride?: Record<string, PackageSpecOverride>;
  ignoreScripts?: boolean;
  json?: boolean;
}

/**
 * Result for a single install level in recursive mode.
 */
export interface RecursiveLevelResult {
  path: string;
  relativePath: string;
  success: boolean;
  trace?: {
    plan: PlanOutput;
    stage: StageOutput;
    apply: ApplyOutput;
  };
  error?: string;
}

/**
 * Result for an isolated package in recursive mode.
 */
export interface RecursiveIsolatedResult {
  path: string;
  relativePath: string;
  success: boolean;
  npmExitCode?: number;
  error?: string;
}

/**
 * Structured output of the recursive install command.
 *
 * Contains per-level results for install levels and isolated packages.
 * Continues on failure — all levels are attempted regardless of individual failures.
 */
export interface RecursiveInstallOutput {
  projectPath: string;
  success: boolean;
  recursive: true;
  levels: RecursiveLevelResult[];
  isolatedPackages: RecursiveIsolatedResult[];
}

// ============================================================================
// Output Router
// ============================================================================

/**
 * Controls where output goes based on the --json flag.
 *
 * When --json is active, structured data goes to stdout and everything else
 * goes to stderr. Without --json, human-friendly messages go to stdout
 * and subprocess output is inherited directly.
 */
export interface OutputRouter {
  /** Structured data output (stdout when --json, suppressed otherwise) */
  json(data: unknown): void;
  /** Human-friendly output (stdout when no --json, suppressed when --json) */
  human(message: string): void;
  /** Auxiliary/progress output (always stderr) */
  log(message: string): void;
  /** Subprocess stdio configuration */
  subprocessStdio(): "inherit" | "pipe";
}
