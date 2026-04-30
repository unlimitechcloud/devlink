# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.6.1] - 2026-04-30

### Fixed
- Early return in install command skipped npm link phase when all packages in the config had the `link` attribute. Projects with only linked packages (no store/npm resolution needed) would silently skip the linking step.

## [2.6.0] - 2026-03-18

### Added
- Selective package install: `dev-link install [packages...]` accepts positional arguments to install only specific packages from the config
  - Packages must be pre-defined in `devlink.config.mjs` — error if not found
  - Filter applies only to resolution/staging phase; removal of orphan packages and `npm install` run normally
  - Works with all package types: normal, synthetic, link, dev

### Changed
- `loadConfig()` API: `mode` and `modeConfig` can now be `undefined` when no mode is specified (previously defaulted to `"dev"`)
- Install flow: staging + `npm install` is now the only flow — npm always runs, no conditional
- `MultiLevelInstallOptions`: replaced `runNpm`/`runScripts` with `npmIgnoreScripts` (inverted logic, default `false`)

### Removed
- `--dev` and `--prod` CLI flags: use `--mode dev` or `--mode prod` instead
- `--npm` CLI flag: npm install now always runs as part of the install flow
- `--run-scripts` CLI flag: replaced by `--npm-ignore-scripts` (inverted logic)
- Legacy "direct copy to node_modules" flow: all installs now go through staging + `file:` protocol injection + `npm install`
- Implicit mode detection from `process.argv` in `loadConfig()` API: now accepts an explicit `mode` parameter

## [2.5.2] - 2026-03-10

### Fixed
- `tree` command now detects sub-packages under `packages/` directories even when no `workspaces` field is defined — these are marked as isolated children

## [2.5.1] - 2026-03-10

### Changed
- Updated documentation (install.md, configuration.md, AGENTS.md, README) for `link` attribute

## [2.5.0] - 2026-03-10

### Added
- `link` attribute for packages in `devlink.config.mjs`: packages with `link` skip store/npm resolution entirely and are resolved via `npm link` after install
- `runNpmLink()` helper: runs `npm link <path>` for a local package, resolving relative paths against the project root
- Link support in all three install flows: no-mode, mode+npm (staging), and direct copy
- `linked` field in `InstallResult` to track successfully linked packages
- Post-install summary showing linked packages count and paths

## [2.4.1] - 2026-03-10

### Fixed
- Staging directory (`.devlink/`) is now fully cleaned at the start of every `installPackages()` run, preventing stale packages from previous executions from remaining between DevLink runs

## [2.4.0] - 2026-03-10

### Added
- `dev: true` package flag: packages marked with `dev: true` in the config are injected into `devDependencies` instead of `dependencies` in `package.json`
- The flag is global (independent of mode or manager type) and has no effect on synthetic packages

## [2.3.2] - 2026-03-09

### Added
- Unit tests for exit code propagation in multilevel installer: skipped packages, npm failures, combined failures, fail-fast behavior, and success cases

## [2.3.1] - 2026-03-09

### Fixed
- Install command now exits with code 1 when package resolution fails (skipped packages) or npm install returns a non-zero exit code — previously returned 0 in both cases
- Multilevel installer (`--recursive`) now propagates npm install failures and skipped packages as level failures instead of silently succeeding

## [2.3.0] - 2026-03-09

### Added
- Bidirectional fallback resolution: npm-primary flows fall back to the local store, and store-primary flows fall back to npm — per-package, with clear warnings
- `checkNpmExists()` helper: verifies per-package npm availability via `npm view` to enable granular fallback decisions
- No-mode store fallback: universal packages not found in npm are now resolved from the store's global namespace (previously skipped)
- npm-manager store fallback: packages not found in npm are resolved from the store using mode namespaces (previously not attempted)

### Changed
- npm manager (`--npm` + `manager: "npm"`) now checks each package individually via `npm view` instead of blindly injecting all as registry dependencies
- No-mode flow now performs per-package `npm view` checks for non-synthetic universal packages, with store (global) fallback
- Updated documentation (install.md, configuration.md, AGENTS.md, README) for bidirectional fallback behavior

## [2.2.3] - 2026-03-04

### Fixed
- `dev-link tree` no longer crashes when `package.json` has no `workspaces` field or an empty array — returns a single-module tree instead

## [2.2.2] - 2026-03-03

### Added
- Synthetic packages (`synthetic: true`): packages are staged to `.devlink/` instead of being injected into `package.json`
- `stageFromNpm()` function in staging module: downloads packages via `npm pack` and extracts to `.devlink/`
- Synthetic staging works in all flows: `--npm` + store, `--npm` + npm manager, direct copy, and no-mode
- When a synthetic package is not found in the store, it falls back to `npm pack` staging instead of `npm install --no-save`

### Changed
- `--npm` flow separates synthetic packages from registry injection — synthetics go to `.devlink/`, non-synthetics to `package.json`
- No-mode flow separates synthetic universal packages — staged via `npm pack` instead of injected
- Direct copy flow handles synthetic packages: found in store → copied to `.devlink/`; not found → `npm pack` to `.devlink/`
- Updated documentation (install.md, configuration.md, AGENTS.md, README) for synthetic package behavior

## [2.2.1] - 2026-03-03

### Fixed
- No-mode install now resolves universal packages (`version: "1.0.0"`) — previously skipped all package resolution when no mode was specified
- Universal packages are injected into `package.json` and resolved via `npm install` regardless of mode

### Changed
- Updated no-mode documentation (install.md, AGENTS.md, README) to reflect universal package resolution behavior

## [2.2.0] - 2026-03-03

### Added
- Universal version format: `version: "1.0.0"` (string) applies to all modes, alongside existing per-mode object format `version: { dev: "1.0.0", remote: "1.0.0" }`
- `resolveVersion(spec, mode)` helper exported from config module
- npm fallback for store manager: when a package is not found in the local store, DevLink falls back to npm with a visible `⚠️` warning instead of silently skipping

### Changed
- `PackageSpecNew.version` now accepts `string | Record<string, string>`
- Config normalization maps string versions to `{ "*": version }` internally
- Updated installation documentation (install.md, configuration.md, AGENTS.md) for universal version format and npm fallback behavior
- Updated README configuration examples to reflect new version formats

### Removed
- Dead `args: ["--no-save"]` from documentation examples (no longer used by install flow)

## [2.1.0] - 2026-03-03

### Added
- No-mode install: `dev-link install --npm` without `--mode` runs npm install at all levels without DevLink package resolution — no config loading, no staging, no store injection
- Tests for no-mode install behavior in multilevel installer

### Changed
- `--mode` is no longer required for `install` command — when omitted, only npm install runs
- `MultiLevelInstallOptions.mode` is now optional (`string | undefined`)
- Updated install documentation (install.md, AGENTS.md, README.md) to reflect no-mode behavior

## [2.0.2] - 2026-03-02

### Changed
- Updated README description to match package.json

## [2.0.1] - 2026-03-02

### Changed
- Updated package description to better reflect current capabilities: package management utility with environment-based install modes and declarative configuration
- Added `tree` command documentation to README (command reference table and detailed usage section)
- Expanded npm keywords for improved discoverability: `workspaces`, `namespace`, `devlink`, `package-manager`, `linking`, `multi-repo`, `local-packages`, `libraries`, `ai-first`

## [2.0.0] - 2026-02-27

### Breaking Changes
- Package version format in `devlink.config.mjs` changed from flat mode keys to nested `version` object. Migration required:
  ```js
  // Before (v1.x)
  packages: {
    "@myorg/core": { dev: "1.0.0", remote: "1.0.0" },
  }
  // After (v2.0)
  packages: {
    "@myorg/core": { version: { dev: "1.0.0", remote: "1.0.0" } },
  }
  ```
- Removed `detectMode` from config interface. Mode detection is now handled externally by the consumer CLI.
- Removed `PackageVersions` type (replaced by `PackageSpecNew`).

### Added
- `tree` command — scans monorepo structure by reading `package.json` workspaces recursively. Detects sub-monorepos and isolated packages. Supports `--json` output for programmatic consumption.
- Multilevel install (`--recursive`) — resolves and installs dependencies at every level of the monorepo hierarchy (root → sub-monorepos → isolated packages), each level with its own staging + npm install cycle.
- Synthetic packages — packages marked `synthetic: true` in config are staged to `.devlink/` and rewritten in `package-lock.json` via `file:` protocol, but not added to `package.json` dependencies. Useful for packages managed by external tools (e.g., `sst install`).
- Custom config file support — `--config-name` and `--config-key` options allow using alternative config files (e.g., `webforgeai.config.mjs` with a `devlink` key).

### Changed
- Install command refactored to use multilevel resolution and tree scanning for recursive monorepo support.
- Staging updated to handle synthetic packages in `file:` protocol rewriting.

### Removed
- `src/installer.ts` and `src/store.ts` (dead code from pre-1.0 architecture, all functionality lives in `src/core/*`).

## [1.3.0] - 2026-02-26

### Changed
- Renamed CLI binary from `devlink` to `dev-link` to avoid conflicts with existing Linux system commands
- The `devlink` binary name is preserved as a backward-compatible alias
- Updated all documentation, README, and help text to reference `dev-link`

## [1.2.0] - 2026-02-26

### Added
- Dynamic `--mode <name>` flag for custom install modes (replaces hardcoded `--dev`/`--prod`)
- Registry package injection: `manager: "npm"` injects exact versions into `package.json` for npm to resolve from configured registries (e.g. GitHub Packages)
- Package removal: packages without a version for the current mode are removed from `package.json` during `--npm` installs
- `detectMode()` config function for automatic mode selection based on environment
- Support for unlimited custom modes (e.g. `dev`, `remote`, `staging`, etc.)

### Changed
- `--dev` and `--prod` are now shorthands for `--mode dev` and `--mode prod`
- `prod` factory is no longer required in config — any mode name works
- Mode factories use dynamic lookup (`config[mode]`) instead of hardcoded `config.dev`/`config.prod`
- `PackageVersions` type accepts arbitrary mode keys (not just `dev`/`prod`)
- Updated installation documentation for new mode system

### Removed
- Hard requirement for `prod` factory in configuration

## [1.1.0] - 2026-02-25

### Added
- Staging flow with `file:` protocol rewriting for `--npm` installs
- `--path` flag in `resolve` command for debugging resolution paths
- Bin linking: DevLink now creates symlinks in `node_modules/.bin/` for packages with `bin` entries
- Broken symlink cleanup: automatically removes orphaned symlinks from `node_modules/.bin/` before linking
- Hierarchical documentation system with per-section `agents.md` guides
- `docs` command supports `.md` extensions and root file filtering
- Full documentation index with links in README
- Changelog section in README with latest release summary
- Release steering guide (`.kiro/steering/release.md`)

### Changed
- `AGENTS.md` (root) is now a concise development guide; `docs/AGENTS.md` is the comprehensive agent guide
- Documentation restructured into sections: store, publishing, installation, inspection, maintenance
- Install command refactored for staging flow support

### Removed
- `--run-scripts` and `--ignore-scripts` flags (no longer needed)
- `docs/README.md` (replaced by `docs/AGENTS.md` and CLI docs)
- `RELEASE.md` (moved to `.kiro/steering/release.md`)

## [1.0.5] - 2026-02-17

### Fixed
- `--version` flag now reads version from package.json instead of hardcoded value

## [1.0.4] - 2026-02-17

### Added
- `--npm` flag for `devlink install` command
  - Runs `npm install` before DevLink installs packages
  - By default runs with `--ignore-scripts` to prevent loops
- `--run-scripts` flag for `devlink install` command
  - Allows npm scripts to run when using `--npm`
- `peerOptional` configuration option for dev mode
  - Transforms matching dependencies to optional peerDependencies when copying packages
  - Prevents npm from trying to resolve internal dependencies from the registry
  - Supports glob patterns: `@scope/*`, exact names, or `*` for all
  - Only modifies copies in node_modules, store packages remain unchanged
- Documentation hints on CLI errors
  - Shows relevant documentation paths when commands are used incorrectly
  - Always references `devlink docs agents` for AI agents

## [1.0.3] - 2025-02-12

### Fixed
- Glob patterns with `**` (recursive) now work correctly (e.g., `dist/**/*.js`)
- Negation patterns in `files` field now properly exclude files (e.g., `!dist/**/*.spec.js`)

### Added
- Tests for glob pattern matching with fixtures

## [1.0.2] - 2025-02-12

### Added
- Centralized store at `~/.devlink/` with namespace isolation
- Multi-version support with precedence resolution
- File locking for concurrent operations
- Commands: publish, push, install, list, resolve, consumers, remove, verify, prune, docs
- Declarative configuration via `devlink.config.mjs`
- CLI with `--repo` flag and `DEVLINK_REPO` env var support
- Comprehensive documentation and AI agent guide (AGENTS.md)
- GitHub Actions for CI and automated publishing
- AI-assisted release workflow (RELEASE.md)

## [1.0.0] - 2025-02-12

### Added
- Initial release of DevLink
