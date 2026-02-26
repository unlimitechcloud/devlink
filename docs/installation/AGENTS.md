# Installation — Agent Guide

Commands and configuration for installing packages from the DevLink store or registry.

## Documents

| Document | Description |
|----------|-------------|
| `install.md` | Install command usage, options, modes, --npm flows |
| `configuration.md` | `devlink.config.mjs` reference, mode factories, lifecycle hooks |

## Install Modes

DevLink supports dynamic modes defined in the config (e.g. `dev`, `remote`, `staging`). Each mode has a manager type:

- **store**: Resolves packages from the local DevLink store
- **npm**: Packages are resolved by npm from a configured registry (e.g. GitHub Packages)

## Install Flows

- **Direct copy** (default): Copies packages directly to `node_modules/`
- **Staging flow** (`--npm` + store manager): Stages packages locally, rewrites internal dependencies to `file:` paths, then runs `npm install`
- **Registry flow** (`--npm` + npm manager): Injects packages as exact versions into temporary `package.json`, npm resolves from registry

Use `--npm` when your DevLink packages have internal dependencies on each other, or when using a remote registry.

## Package Removal

Packages without a version for the current mode are removed from `package.json` during `--npm` installs. This enables mode-specific package sets.

## Configuration

Projects use `devlink.config.mjs` to define:
- Which packages to manage and their versions per mode
- Mode factories (top-level properties like `dev`, `remote`)
- Mode detection logic (`detectMode`)
- Namespace precedence (for store manager)
- Lifecycle hooks (beforeAll, afterAll, beforeEach, afterEach)
