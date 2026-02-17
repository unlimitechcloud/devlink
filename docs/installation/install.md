# Install Command

Installs packages from the DevLink store into a project.

## Usage

```bash
devlink install [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-n, --namespaces <list>` | Override namespace precedence (comma-separated) |
| `-c, --config <path>` | Path to config file |
| `--dev` | Force dev mode |
| `--prod` | Force prod mode |
| `--repo <path>` | Use custom repo path |
| `--npm` | Run `npm install` before DevLink installs packages |
| `--run-scripts` | Allow npm scripts to run (by default npm runs with `--ignore-scripts`) |

## Description

The `install` command:

1. Reads `devlink.config.mjs` from the project
2. Determines the mode (dev or prod)
3. Resolves packages using namespace precedence
4. Creates symlinks in `node_modules`
5. Registers the project as a consumer
6. Creates/updates `devlink.lock`

## Configuration File

Create `devlink.config.mjs` in your project root:

```javascript
export default {
  packages: {
    "@scope/core": { dev: "1.0.0", prod: "1.0.0" },
    "@scope/utils": { dev: "2.0.0", prod: "1.5.0" },
  },

  dev: () => ({
    manager: "store",
    namespaces: ["feature-v2", "global"],
  }),

  prod: () => ({
    manager: "npm",
    args: ["--no-save"],
  }),

  detectMode: (ctx) => {
    if (ctx.env.NODE_ENV === "development") return "dev";
    if (ctx.args.includes("--dev")) return "dev";
    return "prod";
  },
};
```

See [Configuration](configuration.md) for full reference.

## Examples

### Basic Install

```bash
cd my-project
devlink install
```

### Force Dev Mode

```bash
devlink install --dev
```

### Override Namespaces

```bash
devlink install -n feature-v2,global
```

### Custom Config Path

```bash
devlink install -c ./config/devlink.config.mjs
```

### Combined with npm install

```bash
# Run npm install first, then DevLink
devlink install --dev --npm

# Allow npm scripts to run
devlink install --dev --npm --run-scripts
```

## Resolution Process

For each package in the config:

1. Get version for current mode (dev/prod)
2. Search namespaces in order
3. Find first match
4. Create symlink to store location

Example:
```
Config: @scope/core@1.0.0
Namespaces: ["feature-v2", "global"]

1. Search feature-v2/@scope/core/1.0.0 → Not found
2. Search global/@scope/core/1.0.0 → Found!
3. Symlink: node_modules/@scope/core → ~/.devlink/namespaces/global/@scope/core/1.0.0
```

## Lock File

After installation, `devlink.lock` is created/updated:

```json
{
  "packages": {
    "@scope/core": {
      "version": "1.0.0",
      "namespace": "global",
      "signature": "6761ca1f...",
      "resolved": "~/.devlink/namespaces/global/@scope/core/1.0.0"
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

## Modes

### Dev Mode

Uses packages from the DevLink store:

```javascript
dev: () => ({
  manager: "store",
  namespaces: ["feature-v2", "global"],
})
```

### Prod Mode

Uses npm to install packages:

```javascript
prod: () => ({
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

## npm Integration

### Using --npm Flag

The `--npm` flag runs `npm install` before DevLink installs packages. This is useful when you want a single command to handle both npm dependencies and DevLink packages.

```bash
devlink install --dev --npm
```

**Execution order:**
1. `npm install --ignore-scripts` runs first
2. DevLink installs packages from the store

By default, npm runs with `--ignore-scripts` to prevent infinite loops (e.g., if you have a `postinstall` script that calls DevLink). Use `--run-scripts` to allow npm scripts:

```bash
devlink install --dev --npm --run-scripts
```

### Replacing npm install with DevLink

A recommended pattern is to use DevLink as your default install command during development. This ensures DevLink packages are always installed after npm dependencies.

**package.json:**
```json
{
  "scripts": {
    "predev:install": "echo '🔧 Preparing development environment...'",
    "dev:install": "devlink install --dev --npm",
    "postdev:install": "echo '✅ Development environment ready'"
  }
}
```

**Usage:**
```bash
npm run dev:install
```

**Execution flow:**
1. `predev:install` - Runs before (preparation tasks)
2. `dev:install` - Runs npm install + DevLink install
3. `postdev:install` - Runs after (verification, notifications)

This pattern:
- Provides a single command for complete development setup
- Uses npm lifecycle hooks (`pre` and `post` scripts)
- Allows custom logic before and after installation
- Prevents npm from pruning DevLink packages (since DevLink runs after npm)

### Why This Order Matters

When npm runs, it may prune packages from `node_modules` that aren't in `package.json`. By running npm first and DevLink second, DevLink packages are installed after npm's pruning, ensuring they remain in place.

## See Also

- [Configuration](configuration.md) - Full config file reference
- [Namespaces](../store/namespaces.md) - Understanding namespace precedence
- [Push Command](../publishing/push.md) - How push updates consumers
