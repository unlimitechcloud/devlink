# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
