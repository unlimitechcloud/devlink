# Install Command

Installs packages from the DevLink store into a project.

## Usage

```bash
dev-link install [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-m, --mode <name>` | Set install mode (e.g. `dev`, `remote`). When omitted, installs universal packages only |
| `-n, --namespaces <list>` | Override namespace precedence (comma-separated) |
| `-c, --config <path>` | Path to config file |
| `--config-name <filename>` | Config file name to search for (e.g. `webforgeai.config.mjs`) |
| `--config-key <key>` | Key within the config export to extract DevLink config from (e.g. `devlink`) |
| `--npm-ignore-scripts` | Propagate `--ignore-scripts` to `npm install` |
| `-r, --recursive` | Install recursively across all monorepo levels |
| `--repo <path>` | Use custom repo path |

## Description

The `install` command:

1. Reads `devlink.config.mjs` from the project (if available)
2. Determines the mode (via `--mode` or `detectMode`)
3. Resolves packages using namespace precedence (store manager) or injects them for registry resolution (npm manager)
4. Removes packages that don't have a version for the current mode
5. Stages packages to `.devlink/` and injects `file:` protocols into `package.json`
6. Runs `npm install`
7. Cleans broken bin symlinks and links new bin entries into `node_modules/.bin/`
8. Registers the project as a consumer
9. Creates/updates `devlink.lock`

When `--mode` is omitted, the command:
- Loads the config file (if available)
- Resolves packages with universal versions (`version: "1.0.0"`) — these are injected into `package.json` for npm to resolve
- Skips packages with per-mode versions (since no mode is active)
- Runs `npm install`

This means universal packages are always resolved regardless of mode, while per-mode packages require an explicit mode to be installed.

## Configuration File

Create `devlink.config.mjs` in your project root:

```javascript
export default {
  packages: {
    "@scope/core": { version: { dev: "1.0.0", remote: "1.0.0" } },
    "@scope/utils": { version: "2.0.0" },                           // universal
    "@scope/dev-tools": { version: { dev: "1.0.0" } },              // only in dev mode
    "@scope/test-utils": { version: "1.0.0", dev: true },           // → devDependencies
  },

  dev: () => ({
    manager: "store",
    namespaces: ["feature-v2", "global"],
  }),

  remote: () => ({
    manager: "npm",
  }),

  detectMode: (ctx) => {
    if (ctx.env.NODE_ENV === "development") return "dev";
    if (ctx.args.includes("--dev")) return "dev";
    return "remote";
  },
};
```

See [Configuration](configuration.md) for full reference.

## Examples

### Install without Mode (universal packages only)

```bash
dev-link install                          # Resolves universal packages + npm install
dev-link install --recursive              # Recursive across monorepo levels
```

When no `--mode` is specified, DevLink resolves only packages with universal versions (`version: "1.0.0"`), injects them into `package.json`, and runs `npm install`. Per-mode packages are ignored.

### Basic Install

```bash
cd my-project
dev-link install
```

### Specify Mode

```bash
dev-link install --mode dev
dev-link install --mode remote
```

### Override Namespaces

```bash
dev-link install -n feature-v2,global
```

### Custom Config Path

```bash
dev-link install -c ./config/devlink.config.mjs
```

### Combined Examples

```bash
# Dev: stage from store + npm install
dev-link install --mode dev

# Remote: inject registry versions + npm install
dev-link install --mode remote

# Skip npm lifecycle scripts
dev-link install --mode dev --npm-ignore-scripts
```

## Mode System

Modes are defined as top-level factory functions in the config. You can define any number of modes with any name:

```javascript
export default {
  packages: { /* ... */ },
  dev: () => ({ manager: "store", namespaces: ["global"] }),
  remote: () => ({ manager: "npm" }),
  staging: () => ({ manager: "npm" }),
};
```

The mode is determined by (in priority order):
1. `--mode <name>` CLI flag
2. `detectMode()` function in config
3. If none specified → no mode (universal packages only)

### No-Mode Behavior

When no mode is specified (no `--mode`, no `detectMode`), the install command:
- Loads the config file if available
- Resolves packages with universal versions (`version: "1.0.0"`) using bidirectional fallback (npm primary → store global fallback)
- Skips packages with per-mode versions (no active mode to match)
- Runs `npm install`

For each universal package, DevLink checks npm first (`npm view`). If the package exists in npm, it is injected into `package.json` as a registry dependency. If not found in npm, DevLink falls back to the store's `global` namespace — staging the package via `file:` protocol so npm can resolve it locally.

Synthetic universal packages follow the same fallback: `stageFromNpm` (primary) → store global copy to `.devlink/` (fallback).

This ensures universal packages are always installed regardless of mode. Projects that only use universal versions can omit the mode entirely.

## Package Removal

If a package in the config doesn't have a version for the current mode, it is removed from `package.json` during install. This allows mode-specific package sets:

```javascript
packages: {
  "@scope/core": { version: { dev: "1.0.0", remote: "1.0.0" } },  // both modes
  "@scope/dev-tools": { version: { dev: "1.0.0" } },               // dev only — removed in remote
}
```

When running `--mode remote`, `@scope/dev-tools` will be removed from the temporary `package.json` before `npm install` runs.

## Bidirectional Fallback Resolution

DevLink implements a bidirectional fallback strategy that ensures packages can always be resolved, regardless of whether the primary source is npm or the local store. The fallback is consistent for both synthetic and non-synthetic packages — only the destination differs.

### Fallback Rules

| Scenario | Primary | Fallback |
|----------|---------|----------|
| No mode (universal packages) | npm | → store (global namespace) |
| Mode + `manager: "npm"` | npm | → store (mode namespaces) |
| Mode + `manager: "store"` | store (mode namespaces) | → npm |

### How It Works

For each package, DevLink tries the primary source first. Only if the primary fails does it attempt the fallback:

- **npm primary**: DevLink runs `npm view <package>@<version>` to verify the package exists in the npm registry. If it does, the package is injected as a registry dependency (non-synthetic) or staged via `npm pack` (synthetic). If `npm view` fails, DevLink searches the store (global namespace for no-mode, or mode namespaces for npm manager).

- **store primary**: DevLink searches the configured namespaces in order. If the package is found, it is copied/staged from the store. If not found in any namespace, DevLink runs `npm view` to check npm availability and falls back to npm injection (non-synthetic) or `npm pack` staging (synthetic).

### Per-Package Granularity

Fallback is evaluated per-package, not globally. In a single install run, some packages may resolve from npm while others fall back to the store (or vice versa). Each package's resolution path is logged:

```
📡 Resolving 3 universal package(s):
  - @scope/core@1.0.0
  - @scope/utils@2.0.0
  ⚠️  @scope/utils@2.0.0 not found in npm, trying store fallback (global)...
  ✓ @scope/utils@2.0.0 [global] (store fallback → staged)
  - @scope/tools@1.0.0
```

### Synthetic vs Non-Synthetic

The fallback strategy is identical for both — only the destination changes:

| Type | Primary success | Fallback success |
|------|----------------|-----------------|
| Non-synthetic (npm primary) | Injected into `package.json` | Staged from store via `file:` protocol |
| Non-synthetic (store primary) | Staged from store via `file:` protocol | Injected into `package.json` |
| Synthetic (npm primary) | `npm pack` → `.devlink/` | Store copy → `.devlink/` |
| Synthetic (store primary) | Store copy → `.devlink/` | `npm pack` → `.devlink/` |

## Dev Dependencies

Packages marked with `dev: true` are injected into `devDependencies` instead of `dependencies` in `package.json`. This is a global flag — it applies regardless of the install mode or manager type.

```javascript
packages: {
  "@scope/core": { version: "1.0.0" },                    // → dependencies
  "@scope/test-utils": { version: "1.0.0", dev: true },   // → devDependencies
}
```

When DevLink injects packages into `package.json` (via `file:` protocol or registry version), it routes them to the correct section based on this flag. The `dev` flag has no effect on synthetic packages (they are never injected into `package.json`).

## Synthetic Packages

Synthetic packages are staged to `.devlink/` instead of being injected into `package.json`. They are useful for packages that need to be available locally (e.g., for tooling, `file:` references, or build-time dependencies) but should not appear as npm dependencies.

Mark a package as synthetic in the config:

```javascript
packages: {
  "@myorg/sst": { version: { dev: "0.4.0" }, synthetic: true },
}
```

### Synthetic Resolution by Flow

| Flow | Primary | Fallback |
|------|---------|----------|
| Store manager | Staged from store to `.devlink/` | Downloaded via `npm pack` to `.devlink/` |
| npm manager | Downloaded via `npm pack` to `.devlink/` | Staged from store (mode namespaces) to `.devlink/` |
| No-mode + universal | Downloaded via `npm pack` to `.devlink/` | Copied from store (global) to `.devlink/` |

In all cases, synthetic packages end up in `.devlink/{packageName}/` and are never injected into `package.json`.

Example output:
```
📦 Staging 1 synthetic package(s) from npm:
  - @myorg/sst@0.4.0 (synthetic)
```

## Linked Packages

Packages with a `link` attribute skip all resolution (store, npm, staging) and are resolved via `npm link` after `npm install` completes. This is useful for local package development where you want a live symlink instead of a copy.

```javascript
packages: {
  "@myorg/sdk": { version: "1.0.0", link: "../sdk" },
}
```

After install, DevLink runs `npm link <resolved-path>` for each linked package. The result is reported in the install summary:

```
🔗 Linking 1 local package(s):
  - @myorg/sdk → /home/user/project/sdk
  ✓ Linked 1 package(s)
```

Link works in all install flows (no-mode, store manager, npm manager). Relative paths are resolved against the project root.

## Resolution Process

For each package in the config:

1. Get version for current mode (or universal version if no mode)
2. If no version exists for this mode → mark for removal
3. Determine primary source based on scenario:
   - No mode → npm primary
   - `manager: "npm"` → npm primary
   - `manager: "store"` → store primary
4. Try primary source:
   - npm primary: `npm view <pkg>@<version>` to verify availability
   - store primary: search namespaces in order, find first match
5. If primary fails → try fallback:
   - npm primary fallback: search store (global namespace for no-mode, mode namespaces for npm manager)
   - store primary fallback: `npm view <pkg>@<version>` to verify npm availability
6. If both fail → skip with warning

Example (store mode with npm fallback):
```
Config: @scope/core@1.0.0
Namespaces: ["feature-v2", "global"]

1. Search feature-v2/@scope/core/1.0.0 → Not found
2. Search global/@scope/core/1.0.0 → Not found
3. npm view @scope/core@1.0.0 → Found!
4. ⚠️  Inject as registry dependency (npm fallback)
```

Example (npm mode with store fallback):
```
Config: @scope/core@1.0.0
Namespaces: ["feature-v2", "global"]

1. npm view @scope/core@1.0.0 → Not found
2. ⚠️  Search feature-v2/@scope/core/1.0.0 → Not found
3. ⚠️  Search global/@scope/core/1.0.0 → Found!
4. Stage from store (store fallback)
```

## Lock File

After installation, `devlink.lock` is created/updated:

```json
{
  "packages": {
    "@scope/core": {
      "version": "1.0.0",
      "namespace": "global",
      "signature": "6761ca1f..."
    }
  }
}
```

This file:
- Records exact resolution for reproducibility
- Tracks signatures for change detection
- Should be committed to version control

## Consumer Registration

Installing registers your project in `installations.json`, enabling:

- `devlink push` to update your project
- `devlink consumers` to list your project

## Manager Types

### store

Uses the DevLink store as the primary source. Packages are staged to `.devlink/` and injected as `file:` dependencies into `package.json`, then resolved via `npm install`. If a package is not found in the store, DevLink falls back to npm (`npm view` check).

```javascript
dev: () => ({
  manager: "store",
  namespaces: ["feature-v2", "global"],
})
```

### npm

Uses the npm registry as the primary source. Packages are verified via `npm view` and injected as exact versions into `package.json` for npm to resolve. If a package is not found in npm, DevLink falls back to the store (mode namespaces) and stages it via `file:` protocol.

```javascript
remote: () => ({
  manager: "npm",
  args: ["--no-save"],
})
```

## Errors

### Package Not Found

When a package is not found in the primary source, DevLink tries the fallback. If both primary and fallback fail, the package is skipped:

```
  ⚠️  @scope/core@1.0.0 not found in npm, trying store fallback (global)...
  ⚠️  @scope/core@1.0.0 not found in npm or store
```

Or for store-primary flows:
```
  ⚠️  @scope/core@1.0.0 not found in store (feature-v2, global), falling back to npm
  ⚠️  @scope/core@1.0.0 not found in store or npm
```

### Config Not Found

```
Error: devlink.config.mjs not found
```

Create a configuration file in your project root.

### Mode Not Defined

```
Error: Mode "staging" is not defined in devlink.config.mjs
```

The mode specified via `--mode` doesn't have a corresponding factory function in the config.

## npm Integration

DevLink always runs `npm install` as part of the install flow. Behavior depends on the manager type:

**Store manager (`manager: "store"`):**
1. Resolves packages from the DevLink store (primary)
2. Packages not found in store → `npm view` check → injected as registry dependencies (fallback)
3. Stages store-resolved packages to `.devlink/` with internal deps rewritten as `file:` paths
4. Injects staged packages as `file:` dependencies in a temporary `package.json`
5. Removes packages not in the current mode
6. Runs `npm install`
7. Restores original `package.json`

**npm manager (`manager: "npm"`):**
1. Checks each package via `npm view` (primary)
2. Packages found in npm → injected as exact versions in a temporary `package.json`
3. Packages not found in npm → searched in store (mode namespaces) → staged via `file:` protocol (fallback)
4. Removes packages not in the current mode
5. Runs `npm install` (npm resolves registry + staged packages)
6. Restores original `package.json`

### Recommended package.json Scripts

```json
{
  "scripts": {
    "dev:install": "dev-link install --mode dev",
    "remote:install": "dev-link install --mode remote"
  }
}
```

## Staging Flow

DevLink uses a staging mechanism for all install flows:

1. Resolves all packages from the primary source (store or npm)
2. Stages store-resolved packages to a local `.devlink/` directory inside the project
3. Rewrites internal dependencies between staged packages to `file:` relative paths (using semver matching)
4. Temporarily injects staged packages as `file:` dependencies in `package.json`
5. Runs `npm install` (which resolves both npm and staged packages)
6. Restores original `package.json` (always, even on error/signal)
7. Cleans broken bin symlinks and links bin entries for DevLink packages
8. Updates lockfile and installations tracking

The staging directory (`.devlink/`) is fully cleaned at the start of each install run, then recreated as packages are staged. This ensures no stale packages from previous executions remain.

## Bin Linking

When packages define a `bin` field in their `package.json`, DevLink automatically creates symlinks in `node_modules/.bin/` — just like npm would. This ensures CLI tools provided by DevLink packages are available via `npx` or npm scripts.

Before linking, DevLink cleans up any broken symlinks in `.bin/` left over from previously installed packages that no longer exist.

## Lifecycle Hooks

ModeConfig supports lifecycle hooks for custom logic during installation:

```javascript
dev: (ctx) => ({
  manager: "store",
  namespaces: ["global"],
  beforeAll: async () => { /* runs once before any package is installed */ },
  afterAll: async () => { /* runs once after all packages are installed */ },
})
```

| Hook | Signature | When |
|------|-----------|------|
| `beforeAll` | `() => void` | Before any package is installed |
| `afterAll` | `() => void` | After all packages are installed |

## See Also

- [Configuration](configuration.md) - Full config file reference
- [Namespaces](../store/namespaces.md) - Understanding namespace precedence
- [Push Command](../publishing/push.md) - How push updates consumers
