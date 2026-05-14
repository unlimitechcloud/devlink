# Requirements Document

## Introduction

This document specifies the requirements for refactoring DevLink's monolithic `install` command into a composable pipeline of independent, atomic commands. The pipeline follows the composition hierarchy `install = plan → stage → apply`, where `apply = inject → hydrate` and `hydrate = npm-install → link`. Each command produces structured JSON output, enabling external tools to intercept the pipeline at any point and inject custom logic between steps. The config format evolves to support a `modes` object with a reserved `default` key.

## Glossary

- **Pipeline**: The ordered sequence of commands that compose a full installation: plan → stage → apply
- **Atomic_Command**: A self-contained command that performs a single responsibility (plan, stage, inject, npm-install, link)
- **Composite_Command**: A command that orchestrates multiple atomic or composite commands (hydrate, apply, install)
- **Plan_Output**: The structured JSON produced by the plan command, classifying packages into buckets
- **Stage_Output**: The structured JSON produced by the stage command, listing staged packages and relinked dependencies
- **Trace**: A recursive record of all sub-command outputs collected by a composite command
- **Output_Router**: The component that directs output to stdout or stderr based on the `--json` flag
- **Staging_Directory**: The `.devlink/` directory within a project where store packages are copied for installation
- **Mode_Factory**: A function in the config that returns mode-specific settings (manager, namespaces, hooks)
- **Bucket**: One of the five classification categories for packages in plan output: store, registry, link, remove, skipped
- **Store**: The local DevLink package repository at `~/.devlink/`
- **Relink**: The process of rewriting internal dependencies between staged packages to use `file:` protocol references

## Requirements

### Requirement 1: Config Format with Modes Object

**User Story:** As a developer, I want to define installation modes in a structured `modes` object with a `default` key, so that I can run `dev-link install` without specifying `--mode` explicitly.

#### Acceptance Criteria

1. WHEN a config file contains a `modes` object with a `default` key, THE Config_Loader SHALL resolve the default mode name from that key
2. WHEN the `modes.default` value references a mode name that does not exist in the `modes` object, THE Config_Loader SHALL reject the config with an error naming the invalid reference and listing available modes
3. WHEN a `--mode` flag is provided on the CLI, THE Config_Loader SHALL use the explicit mode and ignore `modes.default`
4. THE Config_Loader SHALL validate that each non-`default` entry in the `modes` object is a callable function (ModeFactory)
5. WHEN no `--mode` flag is provided and no `modes.default` key exists, THE Config_Loader SHALL report an error indicating that a default mode must be configured or a `--mode` flag must be provided

### Requirement 2: Plan Command

**User Story:** As a developer, I want to run `dev-link plan` independently to see what packages will be installed and how they are resolved, so that I can inspect the installation plan before executing it.

#### Acceptance Criteria

1. WHEN `dev-link plan` is executed with a valid config and mode, THE Plan_Command SHALL produce a PlanOutput classifying every configured package into exactly one bucket: store, registry, link, remove, or skipped
2. WHEN the resolved mode specifies `manager: "store"`, THE Plan_Command SHALL resolve packages against the store registry first, falling back to npm registry for packages not found in the store
3. WHEN the resolved mode specifies `manager: "npm"`, THE Plan_Command SHALL resolve packages against the npm registry first, falling back to the store registry for packages not found in npm
4. WHEN a package has a `link` attribute in the config, THE Plan_Command SHALL classify it in the `link` bucket regardless of the manager setting
5. WHEN a package has no version defined for the current mode, THE Plan_Command SHALL classify it in the `remove` bucket
6. WHEN a package cannot be found in either store or npm registries, THE Plan_Command SHALL classify it in the `skipped` bucket with a descriptive reason
7. WHEN a `--packages` filter is provided, THE Plan_Command SHALL only process packages matching the filter
8. THE Plan_Command SHALL not mutate the filesystem beyond reading config and registry files

### Requirement 3: Stage Command

**User Story:** As a developer, I want to run `dev-link stage` to copy resolved packages into the `.devlink/` staging directory, so that packages are prepared for injection into the project.

#### Acceptance Criteria

1. WHEN `dev-link stage` receives valid plan output, THE Stage_Command SHALL copy each store-resolved package from its store path to `.devlink/{package-name}/`
2. WHEN staging packages, THE Stage_Command SHALL clean and recreate the `.devlink/` staging directory before copying
3. WHEN two or more staged packages have internal dependencies on each other, THE Stage_Command SHALL rewrite those dependencies to use `file:` protocol relative paths pointing within `.devlink/`
4. WHEN a staged package depends on another staged package but the version does not satisfy the dependency range, THE Stage_Command SHALL leave that dependency unchanged
5. THE Stage_Command SHALL accept plan input from a file path (via `--plan` option) or from stdin
6. THE Stage_Command SHALL not modify the original packages in the store

### Requirement 4: Inject Command

**User Story:** As a developer, I want to run `dev-link inject` to rewrite my project's `package.json` with the correct dependency references, so that npm can resolve staged and registry packages.

#### Acceptance Criteria

1. WHEN `dev-link inject` is executed, THE Inject_Command SHALL add `file:` protocol entries in `package.json` for each staged (non-synthetic) package pointing to its `.devlink/` path
2. WHEN a package is classified in the `registry` bucket, THE Inject_Command SHALL add a version string entry in `package.json` for that package
3. WHEN a package is classified in the `remove` bucket, THE Inject_Command SHALL remove that package from both `dependencies` and `devDependencies` in `package.json`
4. WHEN a package has `synthetic: true`, THE Inject_Command SHALL skip injecting it into `package.json` while keeping it in `.devlink/`
5. WHEN a package has `dev: true`, THE Inject_Command SHALL place it in `devDependencies` instead of `dependencies`
6. THE Inject_Command SHALL accept stage and plan input from file paths or stdin

### Requirement 5: Npm-Install Command

**User Story:** As a developer, I want to run `dev-link npm-install` to execute npm install in the project directory, so that dependencies are resolved and installed into `node_modules/`.

#### Acceptance Criteria

1. WHEN `dev-link npm-install` is executed, THE NpmInstall_Command SHALL spawn `npm install` with `--no-audit` and `--legacy-peer-deps` flags in the project directory
2. WHEN the `--npm-ignore-scripts` flag is provided, THE NpmInstall_Command SHALL pass `--ignore-scripts` to the npm subprocess
3. WHEN `--json` is active, THE NpmInstall_Command SHALL route npm subprocess stdout and stderr to stderr
4. THE NpmInstall_Command SHALL report the npm exit code in its structured output
5. WHEN npm exits with a non-zero code, THE NpmInstall_Command SHALL report failure without throwing an unhandled exception

### Requirement 6: Link Command

**User Story:** As a developer, I want to run `dev-link link` to create npm links for packages with local paths, so that I can develop against local package sources.

#### Acceptance Criteria

1. WHEN `dev-link link` is executed with plan output containing link entries, THE Link_Command SHALL spawn `npm link <resolved-path>` for each link package
2. WHEN an npm link subprocess exits with a non-zero code, THE Link_Command SHALL record the failure with the exit code and continue processing remaining link packages
3. THE Link_Command SHALL report both successful and failed links in its structured output
4. THE Link_Command SHALL accept plan input from a file path or stdin

### Requirement 7: Hydrate Command (Composite)

**User Story:** As a developer, I want to run `dev-link hydrate` to execute npm-install followed by link in sequence, so that I can complete the dependency installation in one step.

#### Acceptance Criteria

1. WHEN `dev-link hydrate` is executed, THE Hydrate_Command SHALL execute npm-install first, then link in sequence
2. WHEN npm-install reports failure, THE Hydrate_Command SHALL skip the link step and report `success: false`
3. THE Hydrate_Command SHALL collect the outputs of npm-install and link into a `trace` object in its output
4. THE Hydrate_Command SHALL accept plan input and propagate it to sub-commands

### Requirement 8: Apply Command (Composite)

**User Story:** As a developer, I want to run `dev-link apply` to execute inject followed by hydrate in sequence, so that I can complete the post-staging steps in one step.

#### Acceptance Criteria

1. WHEN `dev-link apply` is executed, THE Apply_Command SHALL execute inject first, then hydrate in sequence
2. WHEN inject reports failure, THE Apply_Command SHALL skip hydrate and report `success: false`
3. THE Apply_Command SHALL collect the outputs of inject and hydrate into a `trace` object in its output
4. THE Apply_Command SHALL accept stage and plan input and propagate them to sub-commands

### Requirement 9: Install Command (Full Composite)

**User Story:** As a developer, I want to run `dev-link install` to execute the full pipeline (plan → stage → apply) in one command, so that I can install all packages with a single invocation.

#### Acceptance Criteria

1. WHEN `dev-link install` is executed, THE Install_Command SHALL execute plan, then stage, then apply in sequence
2. WHEN any step in the pipeline reports failure, THE Install_Command SHALL stop execution immediately and report `success: false`
3. THE Install_Command SHALL collect the outputs of plan, stage, and apply into a recursive `trace` object in its output
4. WHEN `--recursive` is provided, THE Install_Command SHALL scan the monorepo tree and execute the pipeline at each install level
5. THE Install_Command SHALL support all config-related options (`--config`, `--config-name`, `--config-key`, `--mode`, `--namespaces`, `--packages`)

### Requirement 10: Output Modes

**User Story:** As a tool author, I want structured JSON output when `--json` is active and human-friendly output otherwise, so that I can programmatically consume DevLink output or read it as a human.

#### Acceptance Criteria

1. WHEN `--json` is provided, THE Output_Router SHALL write only valid JSON to stdout
2. WHEN `--json` is not provided, THE Output_Router SHALL write human-friendly progress messages to stdout
3. WHEN `--json` is provided, THE Output_Router SHALL route all non-JSON output (progress messages, subprocess output) to stderr
4. WHEN `--json` is not provided, THE Output_Router SHALL configure subprocess stdio as "inherit" so that npm output appears directly in the terminal
5. THE Output_Router SHALL always write auxiliary log messages to stderr regardless of the `--json` flag

### Requirement 11: Trace Collection in Composite Commands

**User Story:** As a tool author, I want composite commands to include a complete trace of all sub-command outputs, so that I can inspect the full execution history programmatically.

#### Acceptance Criteria

1. THE Composite_Command SHALL include a `trace` field in its output containing the output of every executed sub-command
2. WHEN a composite command contains nested composite commands, THE trace SHALL be recursive (nested composites include their own traces)
3. WHEN a sub-command fails and execution stops, THE trace SHALL contain outputs of all commands executed up to and including the failed command
4. THE trace keys SHALL match the sub-command names (e.g., "plan", "stage", "apply", "inject", "hydrate", "npm-install", "link")

### Requirement 12: Pipeline Interception for External Tools

**User Story:** As an external tool author (e.g., wfai install), I want to execute individual pipeline commands and inject custom logic between them, so that I can extend the installation process without modifying DevLink.

#### Acceptance Criteria

1. THE Pipeline SHALL support execution of individual commands (plan, stage, apply) as independent CLI invocations
2. WHEN `--json` is active, THE Pipeline commands SHALL produce output that is consumable as input by downstream commands
3. THE Stage_Command SHALL accept plan output via `--plan` file path or stdin piping
4. THE Apply_Command SHALL accept stage output via stdin and plan output via `--plan` file path
5. WHEN an external tool executes `plan → [custom logic] → stage → [custom logic] → apply`, THE final filesystem state SHALL be equivalent to running `dev-link install` with the same config (assuming the custom logic does not modify DevLink-managed files)

### Requirement 13: Backward Compatibility

**User Story:** As an existing DevLink user, I want the refactored install command to behave identically to the current one when invoked without new flags, so that my existing workflows continue to work.

#### Acceptance Criteria

1. WHEN `dev-link install` is invoked without `--json`, THE Install_Command SHALL produce human-friendly output equivalent to the current install command behavior
2. WHEN a config uses the existing top-level mode factory pattern (without a `modes` object), THE Config_Loader SHALL continue to support it for backward compatibility
3. THE Install_Command SHALL continue to support all existing flags: `--config`, `--config-name`, `--config-key`, `--mode`, `--namespaces`, `--npm-ignore-scripts`, `--recursive`
4. WHEN `--recursive` is provided, THE Install_Command SHALL scan and install across monorepo levels as it does currently

### Requirement 14: Recursive Mode for Monorepos

**User Story:** As a monorepo developer, I want `dev-link install --recursive` to install packages at every level of my monorepo, so that all sub-projects get their DevLink-managed dependencies.

#### Acceptance Criteria

1. WHEN `--recursive` is provided, THE Install_Command SHALL use the tree scanner to discover all install levels in the monorepo
2. WHEN multiple install levels are discovered, THE Install_Command SHALL execute the pipeline at each level in the correct order (root → sub-monorepos → isolated packages)
3. WHEN an install level fails, THE Install_Command SHALL report the failure with the level path and continue to the next level
4. WHEN `--recursive` is provided with `--json`, THE Install_Command SHALL produce structured output containing results for each install level
