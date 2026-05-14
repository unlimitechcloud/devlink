# Installation — Agent Guide

Commands and configuration for installing packages from the DevLink store or registry.

## Documents

| Document | Description |
|----------|-------------|
| `install.md` | Install command usage, options, modes, flows |
| `plan.md` | Plan command — resolve config + registry into installation plan |
| `stage.md` | Stage command — copy packages to `.devlink/`, rewrite internal deps |
| `inject.md` | Inject command — rewrite `package.json` with file: protocols |
| `npm-install.md` | npm-install command — execute `npm install` |
| `link.md` | Link command — execute `npm link` for local packages |
| `hydrate.md` | Hydrate command — composite: npm-install → link |
| `apply.md` | Apply command — composite: inject → hydrate |
| `configuration.md` | `devlink.config.mjs` reference, mode factories, lifecycle hooks |

## Pipeline Architecture

The install command is a composable pipeline of independent commands:

```
install = plan → stage → apply
                         apply = inject → hydrate
                                          hydrate = npm-install → link
```

Each command:
- Accepts input from the previous step (via `--plan`/`--stage` file or stdin)
- Produces structured JSON output (with `--json`)
- Can be executed independently or as part of the full pipeline

### Atomic Commands

| Command | Responsibility | Mutations |
|---------|---------------|-----------|
| `plan` | Resolve config + registry → classify packages | None (read-only) |
| `stage` | Copy store packages → `.devlink/`, rewrite internal deps | `.devlink/` directory |
| `inject` | Rewrite `package.json` with file: protocols and versions | `package.json` |
| `npm-install` | Execute `npm install` | `node_modules/` |
| `link` | Execute `npm link` for local packages | `node_modules/` symlinks |

### Composite Commands

| Command | Orchestrates | Fail-fast |
|---------|-------------|-----------|
| `hydrate` | npm-install → link | If npm-install fails, skip link |
| `apply` | inject → hydrate | If inject fails, skip hydrate |
| `install` | plan → stage → apply | If any step fails, stop |

## JSON Flag and Pipeline Interception

All pipeline commands support `--json` for structured output:

- **stdout**: Only valid JSON (the command's result)
- **stderr**: Progress messages, subprocess output, logs
- **stdin**: Previous command's JSON output (for piping)

This enables external tools to intercept the pipeline at any point:

```bash
# External tool intercepts between stage and apply
dev-link plan --mode dev --json > /tmp/plan.json
dev-link stage --plan /tmp/plan.json --json > /tmp/stage.json

# Custom logic here (e.g., peer dependency reconciliation)
my-tool check --stage /tmp/stage.json

# Resume pipeline
dev-link apply --stage /tmp/stage.json --plan /tmp/plan.json --json
```

## Install Modes

DevLink supports dynamic modes defined in the config (e.g. `dev`, `remote`, `staging`). Each mode has a manager type:

- **store**: Resolves packages from the local DevLink store. Falls back to npm (per-package `npm view` check) if a package is not found in any configured namespace.
- **npm**: Packages are resolved by npm from a configured registry. Falls back to the local store (mode namespaces) if a package is not found in npm.

When no mode is specified, DevLink uses the `modes.default` value from config, or falls back to universal packages only.

## Bidirectional Fallback

All flows use a consistent bidirectional fallback strategy. The primary source is always tried first; fallback only activates on failure. Fallback is per-package — in a single run, some packages may resolve from the primary and others from the fallback.

| Scenario | Primary | Fallback |
|----------|---------|----------|
| No mode (universal) | npm | → store (global namespace) |
| Mode + `manager: "npm"` | npm | → store (mode namespaces) |
| Mode + `manager: "store"` | store (mode namespaces) | → npm |

The fallback strategy is identical for synthetic and non-synthetic packages — only the destination differs (`.devlink/` for synthetic, `package.json`/`node_modules` for non-synthetic).

## Install Flows

- **No mode** (without `--mode`): Resolves universal packages (`version: "1.0.0"`) with npm as primary and store (global) as fallback. Non-synthetic packages are checked via `npm view` — if found, injected into `package.json`; if not, staged from store via `file:` protocol. Synthetic packages use `npm pack` primary → store global copy fallback. Per-mode packages are skipped.
- **Store manager** (`manager: "store"`): Store is primary — stages packages locally, rewrites internal dependencies to `file:` paths, then runs `npm install`. Packages not found in the store fall back to npm (verified via `npm view`) and are injected as registry dependencies (non-synthetic) or staged via `npm pack` (synthetic).
- **npm manager** (`manager: "npm"`): npm is primary — verifies each package via `npm view`. Non-synthetic packages found in npm are injected as exact versions; not found → fallback to store (mode namespaces) and staged via `file:` protocol. Synthetic packages use `npm pack` primary → store copy fallback.

All flows stage packages to `.devlink/`, inject `file:` protocols into `package.json`, and run `npm install`.

## Version Formats

Package versions support two formats:
- **Per-mode object**: `{ version: { dev: "1.0.0", remote: "1.0.0" } }` — different versions per mode
- **Universal string**: `{ version: "1.0.0" }` — same version for all modes

## Selective Install

When positional arguments are provided (`dev-link install @scope/core @scope/utils`), only those packages are resolved/staged. All other steps (removal, npm install, bin linking) run normally. Each package must exist in the config — an error is thrown otherwise.

## Package Removal

Packages without a version for the current mode are removed from `package.json` during install. This enables mode-specific package sets.

## Linked Packages

Packages with a `link` attribute bypass all resolution and are resolved via `npm link` after install. They are not staged, not injected into `package.json`, and not copied from the store. This works in all install flows.

## Configuration

Projects use `devlink.config.mjs` to define:
- Which packages to manage and their versions (per-mode object or universal string)
- Synthetic flag for packages that should be staged to `.devlink/` instead of `package.json`
- Link attribute for packages resolved via `npm link` instead of store/npm
- Dev flag for packages that should be injected into `devDependencies` instead of `dependencies`
- Mode factories (via `modes` object or top-level properties)
- Default mode (via `modes.default`)
- Mode detection logic (`detectMode`)
- Namespace precedence (for store manager)
- Lifecycle hooks (beforeAll, afterAll)
