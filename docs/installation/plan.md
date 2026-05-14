# Plan Command

Resolves configuration and package registry to produce an installation plan. No filesystem mutations — pure computation.

## Usage

```bash
dev-link plan [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file |
| `--config-name <filename>` | Config file name to search for (e.g. `webforgeai.config.mjs`) |
| `--config-key <key>` | Key within the config export to extract DevLink config from |
| `-m, --mode <name>` | Set install mode (matches config mode name) |
| `-n, --namespaces <list>` | Override namespace precedence (comma-separated) |
| `-p, --packages <list>` | Only plan specific packages (comma-separated) |
| `--json` | Output structured JSON to stdout |

## Description

The `plan` command:

1. Loads and normalizes the config (supports `modes.default` resolution)
2. Resolves the mode factory to determine manager and namespaces
3. For each package: resolves against store registry or npm registry
4. Classifies packages into buckets: `store`, `registry`, `link`, `remove`, `skipped`
5. Produces deterministic JSON output

Every configured package ends up in exactly one bucket. The plan performs no filesystem writes — it only reads config and registry state.

## Resolution Strategy

The resolution strategy depends on the manager type:

| Manager | Primary | Fallback |
|---------|---------|----------|
| `store` | Store (namespace search) | → npm (`npm view`) |
| `npm` | npm (`npm view`) | → Store (mode namespaces) |

Packages with a `link` attribute bypass resolution entirely and go directly to the `link` bucket.

## Examples

### Plan with Default Mode

```bash
dev-link plan
```

### Plan with Explicit Mode

```bash
dev-link plan --mode dev
```

### Plan Specific Packages

```bash
dev-link plan --mode dev --packages @scope/core,@scope/utils
```

### JSON Output for Piping

```bash
dev-link plan --mode dev --json > plan.json
dev-link plan --mode dev --json | dev-link stage --json
```

### External Config

```bash
dev-link plan --config-name webforgeai.config.mjs --config-key devlink --mode dev --json
```

## Output

### JSON Mode (`--json`)

```json
{
  "version": "1",
  "mode": "dev",
  "manager": "store",
  "namespaces": ["global"],
  "projectPath": "/home/user/my-project",
  "packages": {
    "store": [
      { "name": "@scope/core", "version": "1.0.0", "namespace": "global", "path": "/home/user/.devlink/namespaces/global/@scope/core/1.0.0" }
    ],
    "registry": [
      { "name": "@scope/utils", "version": "2.0.0", "namespace": "npm", "path": "" }
    ],
    "link": [
      { "name": "@scope/sdk", "version": "1.0.0", "path": "../sdk", "dev": false }
    ],
    "remove": ["@scope/ci-tools"],
    "skipped": [
      { "name": "@scope/old", "version": "1.0.0", "reason": "not found in store or npm" }
    ]
  }
}
```

### Human Mode (default)

```
── Plan ──
  Mode: dev | Manager: store | Namespaces: global
  3 from store, 1 from registry, 1 link, 1 remove
```

## Errors

### Config Not Found

```
✗ Plan failed: devlink.config.mjs not found
```

Create a config file or provide `--config`.

### Mode Not Defined

```
✗ Plan failed: Mode "staging" is not defined in config
```

The specified mode doesn't have a corresponding factory in the config.

### Package Not in Config

```
✗ Plan failed: Package "@scope/unknown" is not defined in config
```

When using `--packages`, each package must exist in the config.

## See Also

- [Stage Command](stage.md) - Next step: stage planned packages
- [Install Command](install.md) - Full pipeline orchestrator
- [Configuration](configuration.md) - Config file reference
