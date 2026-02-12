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

## See Also

- [Configuration](configuration.md) - Full config file reference
- [Namespaces](../store/namespaces.md) - Understanding namespace precedence
- [Push Command](../publishing/push.md) - How push updates consumers
