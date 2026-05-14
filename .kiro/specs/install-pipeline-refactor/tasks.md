# Implementation Plan: Install Pipeline Refactor

## Overview

Refactor DevLink's monolithic `install` command (~900 lines) into a composable pipeline of independent, atomic commands following the composition hierarchy: `install = plan → stage → apply`, where `apply = inject → hydrate` and `hydrate = npm-install → link`. Each command produces structured JSON output and can be executed independently or composed via piping.

## Tasks

- [x] 1. Define pipeline types and OutputRouter utility
  - [x] 1.1 Create pipeline output type definitions
    - Create `src/pipeline/types.ts` with all pipeline interfaces: `PlanOutput`, `PlanPackageEntry`, `PlanLinkEntry`, `PlanSkippedEntry`, `StageOutput`, `StagedEntry`, `RelinkEntry`, `InjectOutput`, `InjectedEntry`, `RegistryEntry`, `NpmInstallOutput`, `LinkOutput`, `LinkedEntry`, `FailedLinkEntry`, `HydrateOutput`, `ApplyOutput`, `InstallOutput`
    - Include option interfaces: `PlanOptions`, `StageOptions`, `InjectOptions`, `NpmInstallOptions`, `LinkOptions`, `HydrateOptions`, `ApplyOptions`
    - Export the `OutputRouter` interface
    - _Requirements: 2.1, 3.1, 4.1, 5.4, 6.3, 7.3, 8.3, 9.3, 10.1, 11.1_

  - [x] 1.2 Implement OutputRouter utility
    - Create `src/pipeline/output-router.ts` implementing the `OutputRouter` interface
    - When `jsonMode=true`: `json()` writes to stdout, `human()` is no-op, `subprocessStdio()` returns `"pipe"`
    - When `jsonMode=false`: `json()` is no-op, `human()` writes to stdout, `subprocessStdio()` returns `"inherit"`
    - `log()` always writes to stderr regardless of mode
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x]* 1.3 Write property test for OutputRouter (Property 15: Output Isolation)
    - **Property 15: Output Isolation**
    - **Validates: Requirements 10.1, 10.3, 10.5**
    - Use fast-check to verify that with `--json` active, only valid JSON goes to stdout; all other output goes to stderr

  - [x] 1.4 Implement `readPipelineInput` utility
    - Create `src/pipeline/input.ts` with `readPipelineInput<T>(filePath?: string): Promise<T>`
    - Read from file path if provided, otherwise read from stdin
    - Throw descriptive error if file doesn't exist or JSON is invalid
    - _Requirements: 3.5, 4.6, 6.4, 12.2, 12.3_

- [x] 2. Update config loader to support `modes` object
  - [x] 2.1 Extend config loader with `modes.default` resolution
    - Modify `src/config.ts` to detect and handle the new `modes` object format
    - Implement `resolveMode(config, explicitMode?)` function: returns explicit mode when provided, `modes.default` otherwise
    - Validate that `modes.default` references an existing mode key
    - Validate that each non-`default` entry in `modes` is a callable function
    - Maintain backward compatibility with existing top-level mode factory pattern
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 13.2_

  - [x]* 2.2 Write property tests for config mode resolution (Properties 1, 2, 18)
    - **Property 1: Mode Resolution Determinism** — `resolveMode` always returns explicit mode when provided, `modes.default` otherwise
    - **Property 2: Config Validation Rejects Invalid Modes** — invalid `modes.default` or non-callable entries are rejected
    - **Property 18: Legacy Config Backward Compatibility** — configs without `modes` object still load correctly
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 13.2**

- [x] 3. Implement Plan command (atomic)
  - [x] 3.1 Create plan resolver core logic
    - Create `src/pipeline/plan.ts` with `executePlan(options: PlanOptions): Promise<PlanOutput>`
    - Load and normalize config using updated config loader
    - Resolve mode via `resolveMode()` (explicit `--mode` or `modes.default`)
    - Determine manager and namespaces from mode factory
    - Classify each package into exactly one bucket: store, registry, link, remove, or skipped
    - For `manager: "store"`: check store first, fallback to npm
    - For `manager: "npm"`: check npm first, fallback to store
    - Link packages bypass resolution entirely
    - Packages with no version for current mode go to `remove`
    - Apply `--packages` filter when provided
    - No filesystem mutations beyond reading config/registry
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x]* 3.2 Write property tests for plan resolution (Properties 3, 4, 5, 6, 7)
    - **Property 3: Bucket Exclusivity** — every package lands in exactly one bucket
    - **Property 4: Resolution Priority by Manager** — store-first vs npm-first based on manager setting
    - **Property 5: Link Packages Bypass Resolution** — link packages always in link bucket
    - **Property 6: Package Filter Restricts Output** — only filtered packages appear in output
    - **Property 7: Plan and Store Immutability** — plan performs no filesystem writes
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

  - [x] 3.3 Register `plan` CLI command
    - Add `plan` command to `src/cli.ts` using Commander.js
    - Options: `--config`, `--config-name`, `--config-key`, `--mode`, `--namespaces`, `--packages`, `--json`
    - Wire to `executePlan` and use OutputRouter for output routing
    - _Requirements: 2.1, 10.1, 12.1_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Stage command (atomic)
  - [x] 5.1 Create stage core logic
    - Create `src/pipeline/stage.ts` with `executeStage(options: StageOptions): Promise<StageOutput>`
    - Accept plan input from file path (`--plan`) or stdin via `readPipelineInput`
    - Clean and recreate `.devlink/` staging directory
    - Copy each store-resolved package from its store path to `.devlink/{package-name}/`
    - Stage synthetic packages from npm via `npm pack` + extract (reuse `stageFromNpm` from `src/core/staging.ts`)
    - Rewrite internal dependencies between staged packages to `file:` relative paths using semver satisfaction check
    - Produce structured `StageOutput`
    - Do not modify original packages in the store
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 5.2 Write property tests for staging (Properties 8, 9)
    - **Property 8: Staging Produces Clean State** — `.devlink/` contains exactly the planned store packages
    - **Property 9: Relink Correctness** — dependency rewritten to `file:` iff staged version satisfies semver range; every `file:` reference points to valid directory
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6**

  - [x] 5.3 Register `stage` CLI command
    - Add `stage` command to `src/cli.ts`
    - Options: `--plan`, `--json`
    - Accept plan input from `--plan` file or stdin
    - Wire to `executeStage` with OutputRouter
    - _Requirements: 3.5, 10.1, 12.1, 12.3_

- [x] 6. Implement Inject command (atomic)
  - [x] 6.1 Create inject core logic
    - Create `src/pipeline/inject.ts` with `executeInject(options: InjectOptions): Promise<InjectOutput>`
    - Accept stage and plan input from file paths or stdin
    - Add `file:` protocol entries for staged non-synthetic packages
    - Add version string entries for registry packages
    - Remove packages in the `remove` bucket from both `dependencies` and `devDependencies`
    - Skip synthetic packages (keep in `.devlink/` but don't inject into `package.json`)
    - Place `dev: true` packages in `devDependencies`
    - Produce structured `InjectOutput`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x]* 6.2 Write property test for inject classification (Property 10)
    - **Property 10: Inject Classification Correctness** — each package placed in correct location based on classification and flags
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [x] 6.3 Register `inject` CLI command
    - Add `inject` command to `src/cli.ts`
    - Options: `--stage`, `--plan`, `--json`
    - Wire to `executeInject` with OutputRouter
    - _Requirements: 4.6, 10.1, 12.1_

- [x] 7. Implement NpmInstall and Link commands (atomic)
  - [x] 7.1 Create npm-install core logic
    - Create `src/pipeline/npm-install.ts` with `executeNpmInstall(options: NpmInstallOptions): Promise<NpmInstallOutput>`
    - Spawn `npm install --no-audit --legacy-peer-deps` in project directory
    - Pass `--ignore-scripts` when `npmIgnoreScripts` option is set
    - Route npm stdout/stderr to stderr when `--json` is active (via OutputRouter's `subprocessStdio()`)
    - Report exit code in structured output without throwing on non-zero
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 7.2 Write property test for npm-install exit code reporting (Property 11)
    - **Property 11: Subprocess Exit Code Reporting** — exit code always included in output, no unhandled exceptions
    - **Validates: Requirements 5.4, 5.5**

  - [x] 7.3 Create link core logic
    - Create `src/pipeline/link.ts` with `executeLink(options: LinkOptions): Promise<LinkOutput>`
    - Accept plan input from file path or stdin
    - For each link package: spawn `npm link <resolved-path>`
    - Record successes in `linked[]` and failures in `failed[]` with exit codes
    - Process all entries regardless of individual failures
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x]* 7.4 Write property test for link resilience (Property 12)
    - **Property 12: Link Command Resilience** — all entries processed, successes and failures recorded separately
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [x] 7.5 Register `npm-install` and `link` CLI commands
    - Add `npm-install` command to `src/cli.ts` with options: `--npm-ignore-scripts`, `--json`
    - Add `link` command to `src/cli.ts` with options: `--plan`, `--json`
    - Wire to respective execute functions with OutputRouter
    - _Requirements: 5.1, 6.1, 10.1, 12.1_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement composite commands (hydrate, apply, install)
  - [x] 9.1 Create composite execution utility
    - Create `src/pipeline/composite.ts` with generic `executeComposite` function
    - Implements fail-fast: if any step reports failure, skip subsequent steps
    - Collects trace with keys matching sub-command names
    - Supports recursive nesting (composites within composites)
    - _Requirements: 7.2, 8.2, 9.2, 11.1, 11.2, 11.3, 11.4_

  - [x] 9.2 Implement hydrate command (composite: npm-install → link)
    - Create `src/pipeline/hydrate.ts` with `executeHydrate(options: HydrateOptions): Promise<HydrateOutput>`
    - Execute npm-install first; if it fails, skip link and report `success: false`
    - Execute link
    - Collect outputs into `trace` with keys `"npm-install"` and `"link"`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 9.3 Implement apply command (composite: inject → hydrate)
    - Create `src/pipeline/apply.ts` with `executeApply(options: ApplyOptions): Promise<ApplyOutput>`
    - Execute inject first; if it fails, skip hydrate and report `success: false`
    - Execute hydrate
    - Collect outputs into `trace` with keys `"inject"` and `"hydrate"`
    - Accept stage and plan input, propagate to sub-commands
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 9.4 Implement install command (composite: plan → stage → apply)
    - Create `src/pipeline/install.ts` with `executeInstall(options: InstallOptions): Promise<InstallOutput>`
    - Execute plan → stage → apply in sequence
    - Fail-fast: if any step fails, stop and report `success: false`
    - Collect outputs into recursive `trace` with keys `"plan"`, `"stage"`, `"apply"`
    - Support all config-related options
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [x]* 9.5 Write property tests for composite commands (Properties 13, 14)
    - **Property 13: Composite Fail-Fast Propagation** — failure in sub-command skips subsequent steps, reports `success: false`
    - **Property 14: Trace Completeness and Structure** — trace contains keys matching sub-command names, includes all executed outputs
    - **Validates: Requirements 7.2, 8.2, 9.2, 11.1, 11.2, 11.3, 11.4**

  - [x] 9.6 Register `hydrate`, `apply` CLI commands and refactor `install` command
    - Add `hydrate` command to `src/cli.ts` with options: `--plan`, `--npm-ignore-scripts`, `--json`
    - Add `apply` command to `src/cli.ts` with options: `--stage`, `--plan`, `--npm-ignore-scripts`, `--json`
    - Refactor existing `install` command to delegate to `executeInstall` from the pipeline
    - Preserve all existing flags: `--config`, `--config-name`, `--config-key`, `--mode`, `--namespaces`, `--packages`, `--npm-ignore-scripts`, `--json`, `--recursive`
    - Ensure human-friendly output without `--json` matches current behavior
    - _Requirements: 9.5, 10.2, 12.1, 13.1, 13.3_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Integrate recursive mode
  - [x] 11.1 Add recursive pipeline execution to install command
    - When `--recursive` is provided, use tree scanner to discover install levels
    - Execute the pipeline at each level in order: root → sub-monorepos → isolated packages
    - Continue to next level on failure, report per-level results with paths
    - With `--json`, produce structured output containing results for each level
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 9.4_

  - [x]* 11.2 Write property tests for recursive execution (Properties 19, 20)
    - **Property 19: Recursive Execution Order** — levels execute in hierarchical order: root → sub-monorepos → isolated
    - **Property 20: Recursive Resilience** — continues on failure, reports all level outcomes
    - **Validates: Requirements 14.2, 14.3, 14.4**

- [x] 12. Pipeline composability and backward compatibility verification
  - [x]* 12.1 Write property test for pipeline composability (Property 17)
    - **Property 17: Pipeline Output Composability** — plan output is valid stage input, stage output is valid apply input
    - **Validates: Requirement 12.2**

  - [x]* 12.2 Write integration test for composition equivalence (Property 16)
    - **Property 16: Composition Equivalence** — `dev-link install --json` produces same filesystem state as `plan | stage | apply` piped individually
    - **Validates: Requirement 12.5**

  - [x] 12.3 Create pipeline barrel export
    - Create `src/pipeline/index.ts` exporting all pipeline functions: `executePlan`, `executeStage`, `executeInject`, `executeNpmInstall`, `executeLink`, `executeHydrate`, `executeApply`, `executeInstall`
    - Update `src/index.ts` to re-export pipeline module for library API usage
    - _Requirements: 12.1, 12.2_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `src/commands/install.ts` is preserved during development; the refactored `install` command delegates to the new pipeline. The old code can be removed once all tests pass.
- `fast-check` must be added as a dev dependency before running property tests

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.4"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7.1", "7.3"] },
    { "id": 7, "tasks": ["7.2", "7.4", "7.5"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] },
    { "id": 10, "tasks": ["9.4"] },
    { "id": 11, "tasks": ["9.5", "9.6"] },
    { "id": 12, "tasks": ["11.1"] },
    { "id": 13, "tasks": ["11.2", "12.1", "12.2", "12.3"] }
  ]
}
```
