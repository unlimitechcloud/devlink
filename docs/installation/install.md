# Install Command

Installs packages from the DevLink store into a project.

## Usage

```bash
dev-link install [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-m, --mode <name>` | Set install mode (e.g. `dev`, `remote`) |
| `-n, --namespaces <list>` | Override namespace precedence (comma-separated) |
| `-c, --config <path>` | Path to config file |
| `--dev` | Force dev mode (shorthand for `--mode dev`) |
| `--prod` | Force prod mode (shorthand for `--mode prod`) |
| `--repo <path>` | Use custom repo path |
| `--npm` | Run `npm install` with DevLink package management |

## Description

The `install` command:

1. Reads `devlink.config.mjs` from the project
2. Determines the mode (via `--mode`, `--dev`/`--prod` shorthands, or `detectMode`)
3. Resolves packages using namespace precedence (store manager) or injects them for registry resolution (npm manager)
4. Removes packages that don't have a version for the current mode
5. Copies packages to `node_modules` (or stages them for `--npm` flow)
6. Cleans broken bin symlinks and links new bin entries into `node_modules/.bin/`
7. Registers the project as a consumer
8. Creates/updates `devlink.lock`

## Configuration File

Create `devlink.config.mjs` in your project root:

```javascript
export default {
  packages: {
    "@scope/core": { dev: "1.0.0", remote: "1.0.0" },
    "@scope/utils": { dev: "2.0.0", remote: "1.5.0" },
    "@scope/dev-tools": { dev: "1.0.0" },  // only in dev mode
  },

  dev: () => ({
    manager: "store",
    namespaces: ["feature-v2", "global"],
  }),

  remote: () => ({
    manager: "npm",
    args: ["--no-save"],
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

### Shorthand Flags

```bash
dev-link install --dev    # same as --mode dev
dev-link install --prod   # same as --mode prod
```

### Override Namespaces

```bash
dev-link install -n feature-v2,global
```

### Custom Config Path

```bash
dev-link install -c ./config/devlink.config.mjs
```

### Combined with npm install

```bash
# Dev: stage from store + npm install
dev-link install --mode dev --npm

# Remote: inject registry versions + npm install
dev-link install --mode remote --npm
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
2. `--dev` / `--prod` shorthand flags
3. `detectMode()` function in config
4. Default: `"dev"`

## Package Removal

If a package in the config doesn't have a version for the current mode, it is removed from `package.json` during the `--npm` flow. This allows mode-specific package sets:

```javascript
packages: {
  "@scope/core": { dev: "1.0.0", remote: "1.0.0" },     // both modes
  "@scope/dev-tools": { dev: "1.0.0" },                   // dev only — removed in remote
}
```

When running `--mode remote --npm`, `@scope/dev-tools` will be removed from the temporary `package.json` before `npm install` runs.

## Resolution Process

For each package in the config:

1. Get version for current mode
2. If no version exists for this mode → mark for removal (--npm flow)
3. If `manager: "store"` → search namespaces in order, find first match
4. If `manager: "npm"` → inject as exact version for npm to resolve from registry

Example (store mode):
```
Config: @scope/core@1.0.0
Namespaces: ["feature-v2", "global"]

1. Search feature-v2/@scope/core/1.0.0 → Not found
2. Search global/@scope/core/1.0.0 → Found!
3. Copy to node_modules/@scope/core
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

Uses the DevLink store to resolve packages. Packages are copied from the local store to `node_modules`.

```javascript
dev: () => ({
  manager: "store",
  namespaces: ["feature-v2", "global"],
})
```

### npm

Packages are resolved by npm from the configured registry (e.g. GitHub Packages, npmjs.org). When used with `--npm`, DevLink injects the packages as exact versions into a temporary `package.json` so npm can resolve them.

```javascript
remote: () => ({
  manager: "npm",
  args: ["--no-save"],
})
```

## Errors

### Package Not Found

```
Error: @scope/core@1.0.0 not found in namespaces: feature-v2, global
```

The package hasn't been published to any of the configured namespaces.

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

### Using --npm Flag

The `--npm` flag enables DevLink's npm integration. Behavior depends on the manager type:

**Store manager (`manager: "store"`):**
1. Resolves packages from the DevLink store
2. Stages them to `.devlink/` with internal deps rewritten as `file:` paths
3. Injects staged packages as `file:` dependencies in a temporary `package.json`
4. Removes packages not in the current mode
5. Runs `npm install`
6. Restores original `package.json`

**npm manager (`manager: "npm"`):**
1. Injects packages as exact versions in a temporary `package.json`
2. Removes packages not in the current mode
3. Runs `npm install` (npm resolves from configured registry)
4. Restores original `package.json`

### Recommended package.json Scripts

```json
{
  "scripts": {
    "dev:install": "dev-link install --mode dev --npm",
    "remote:install": "dev-link install --mode remote --npm"
  }
}
```

## Staging Flow (--npm with store manager)

When `--npm` is used with `manager: "store"`, DevLink uses a staging mechanism:

1. Resolves all packages from the store
2. Copies them to a local `.devlink/` staging directory inside the project
3. Rewrites internal dependencies between staged packages to `file:` relative paths (using semver matching)
4. Temporarily injects staged packages as `file:` dependencies in `package.json`
5. Runs `npm install` (which resolves both npm and staged packages)
6. Restores original `package.json` (always, even on error/signal)
7. Cleans broken bin symlinks and links bin entries for DevLink packages
8. Updates lockfile and installations tracking

The staging directory (`.devlink/`) is cleaned and recreated on each install.

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
  beforeEach: async (pkg) => { /* runs before each package install */ },
  afterEach: async (pkg) => { /* runs after each package install */ },
})
```

| Hook | Signature | When |
|------|-----------|------|
| `beforeAll` | `() => void` | Before any package is installed |
| `afterAll` | `() => void` | After all packages are installed |
| `beforeEach` | `(pkg: ResolvedPackage) => void` | Before each package (direct copy mode only) |
| `afterEach` | `(pkg: ResolvedPackage) => void` | After each package (direct copy mode only) |

Note: `beforeEach`/`afterEach` are only called in direct copy mode (without `--npm`). The staging flow calls `beforeAll`/`afterAll` only.

## See Also

- [Configuration](configuration.md) - Full config file reference
- [Namespaces](../store/namespaces.md) - Understanding namespace precedence
- [Push Command](../publishing/push.md) - How push updates consumers
