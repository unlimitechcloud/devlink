# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
