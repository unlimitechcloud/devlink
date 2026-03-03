# Installation — Agent Guide

Commands and configuration for installing packages from the DevLink store or registry.

## Documents

| Document | Description |
|----------|-------------|
| `install.md` | Install command usage, options, modes, --npm flows |
| `configuration.md` | `devlink.config.mjs` reference, mode factories, lifecycle hooks |

## Install Modes

DevLink supports dynamic modes defined in the config (e.g. `dev`, `remote`, `staging`). Each mode has a manager type:

- **store**: Resolves packages from the local DevLink store. Falls back to npm with a warning if a package is not found in the store.
- **npm**: Packages are resolved by npm from a configured registry (e.g. GitHub Packages)

When no mode is specified, DevLink skips package resolution entirely and only runs `npm install` (if `--npm` is set).

## Install Flows

- **No mode** (`--npm` without `--mode`): Runs `npm install` only, no config loading or package resolution. Useful for monorepo orchestration without DevLink package management.
- **Direct copy** (default with mode): Copies packages directly to `node_modules/`. Falls back to `npm install --no-save` for packages not found in the store.
- **Staging flow** (`--npm` + store manager): Stages packages locally, rewrites internal dependencies to `file:` paths, then runs `npm install`. Packages not found in the store are injected as registry packages.
- **Registry flow** (`--npm` + npm manager): Injects packages as exact versions into temporary `package.json`, npm resolves from registry

Use `--npm` when your DevLink packages have internal dependencies on each other, or when using a remote registry.

## Version Formats

Package versions support two formats:
- **Per-mode object**: `{ version: { dev: "1.0.0", remote: "1.0.0" } }` — different versions per mode
- **Universal string**: `{ version: "1.0.0" }` — same version for all modes

## Package Removal

Packages without a version for the current mode are removed from `package.json` during `--npm` installs. This enables mode-specific package sets.

## Configuration

Projects use `devlink.config.mjs` to define:
- Which packages to manage and their versions (per-mode object or universal string)
- Mode factories (top-level properties like `dev`, `remote`)
- Mode detection logic (`detectMode`)
- Namespace precedence (for store manager)
- Lifecycle hooks (beforeAll, afterAll, beforeEach, afterEach)
