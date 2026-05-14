/**
 * Pipeline Barrel Export — Public API for the DevLink install pipeline.
 *
 * Re-exports all pipeline functions, types, and utilities for programmatic
 * usage as a library. External tools (like `wfai install`) can import from
 * this module to compose pipeline steps with custom logic between them.
 */

// Pipeline execution functions
export { executePlan } from "./plan.js";
export { executeStage } from "./stage.js";
export { executeInject } from "./inject.js";
export { executeNpmInstall } from "./npm-install.js";
export { executeLink } from "./link.js";
export { executeHydrate } from "./hydrate.js";
export { executeApply } from "./apply.js";
export { executeInstall, executeInstallRecursive } from "./install.js";

// Output routing utility
export { createOutputRouter } from "./output-router.js";

// Pipeline input utility
export { readPipelineInput } from "./input.js";

// All pipeline types
export type {
  // Plan types
  PlanOptions,
  PlanOutput,
  PlanPackageEntry,
  PlanLinkEntry,
  PlanSkippedEntry,
  // Stage types
  StageOptions,
  StageOutput,
  StagedEntry,
  RelinkEntry,
  // Inject types
  InjectOptions,
  InjectOutput,
  InjectedEntry,
  RegistryEntry,
  // NpmInstall types
  NpmInstallOptions,
  NpmInstallOutput,
  // Link types
  LinkOptions,
  LinkOutput,
  LinkedEntry,
  FailedLinkEntry,
  // Hydrate types
  HydrateOptions,
  HydrateOutput,
  // Apply types
  ApplyOptions,
  ApplyOutput,
  // Install types
  InstallOptions,
  InstallOutput,
  // Recursive install types
  RecursiveInstallOptions,
  RecursiveInstallOutput,
  RecursiveLevelResult,
  RecursiveIsolatedResult,
  // Output router interface
  OutputRouter,
} from "./types.js";
