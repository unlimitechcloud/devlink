# Installation — Agent Guide

Commands and configuration for installing packages from the DevLink store or registry.

## Documents

| Document | Description |
|----------|-------------|
| `install.md` | Install command usage, options, modes, --npm flows |
| `configuration.md` | `devlink.config.mjs` reference, mode factories, lifecycle hooks |

## Install Modes

DevLink supports dynamic modes defined in the config (e.g. `dev`, `remote`, `staging`). Each mode has a manager type:

- **store**: Resolves packages from the local DevLink store. Falls back to npm (per-package `npm view` check) if a package is not found in any configured namespace.
- **npm**: Packages are resolved by npm from a configured registry. Falls back to the local store (mode namespaces) if a package is not found in npm.

When no mode is specified, DevLink uses npm as the primary source with store (global namespace) as fallback.

## Bidirectional Fallback

All flows use a consistent bidirectional fallback strategy. The primary source is always tried first; fallback only activates on failure. Fallback is per-package — in a single run, some packages may resolve from the primary and others from the fallback.

| Scenario | Primary | Fallback |
|----------|---------|----------|
| No mode (universal) | npm | → store (global namespace) |
| Mode + `manager: "npm"` | npm | → store (mode namespaces) |
| Mode + `manager: "store"` | store (mode namespaces) | → npm |

The fallback strategy is identical for synthetic and non-synthetic packages — only the destination differs (`.devlink/` for synthetic, `package.json`/`node_modules` for non-synthetic).

## Install Flows

- **No mode** (`--npm` without `--mode`): Resolves universal packages (`version: "1.0.0"`) with npm as primary and store (global) as fallback. Non-synthetic packages are checked via `npm view` — if found, injected into `package.json`; if not, staged from store via `file:` protocol. Synthetic packages use `npm pack` primary → store global copy fallback. Per-mode packages are skipped.
- **Direct copy** (default with mode): Copies packages directly to `node_modules/`. Synthetic packages are copied to `.devlink/` instead. Falls back to `npm install --no-save` for non-synthetic packages not found in the store; synthetic fallbacks use `npm pack` to `.devlink/`.
- **Staging flow** (`--npm` + store manager): Store is primary — stages packages locally, rewrites internal dependencies to `file:` paths, then runs `npm install`. Packages not found in the store fall back to npm (verified via `npm view`) and are injected as registry dependencies (non-synthetic) or staged via `npm pack` (synthetic).
- **Registry flow** (`--npm` + npm manager): npm is primary — verifies each package via `npm view`. Non-synthetic packages found in npm are injected as exact versions; not found → fallback to store (mode namespaces) and staged via `file:` protocol. Synthetic packages use `npm pack` primary → store copy fallback.

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
- Synthetic flag for packages that should be staged to `.devlink/` instead of `package.json`
- Mode factories (top-level properties like `dev`, `remote`)
- Mode detection logic (`detectMode`)
- Namespace precedence (for store manager)
- Lifecycle hooks (beforeAll, afterAll, beforeEach, afterEach)
