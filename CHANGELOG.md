# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
