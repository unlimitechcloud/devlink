# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
