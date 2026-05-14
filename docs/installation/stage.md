# Stage Command

Copies packages from the store to `.devlink/` staging directory and rewrites internal dependencies between staged packages to `file:` protocols.

## Usage

```bash
dev-link stage [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--plan <path>` | Path to plan JSON file (reads from stdin if omitted) |
| `--json` | Output structured JSON to stdout |

## Description

The `stage` command:

1. Reads plan output (from file via `--plan` or from stdin)
2. Cleans and recreates the `.devlink/` staging directory
3. Copies each `store` package from its store path to `.devlink/{name}/`
4. Rewrites internal dependencies between staged packages to `file:` relative paths (semver-aware)
5. Produces structured output listing staged packages and relinked deps

The staging directory is fully cleaned at the start — no stale packages from previous runs remain. Original store packages are never modified.

## Input

The stage command requires plan output as input. It can be provided via:

- **File**: `--plan /path/to/plan.json`
- **Stdin**: piped from `dev-link plan --json`

## Examples

### Pipe from Plan

```bash
dev-link plan --mode dev --json | dev-link stage --json
```

### Use Plan File

```bash
dev-link plan --mode dev --json > /tmp/plan.json
dev-link stage --plan /tmp/plan.json --json
```

### Human Output

```bash
dev-link plan --mode dev --json | dev-link stage
```

## Output

### JSON Mode (`--json`)

```json
{
  "projectPath": "/home/user/my-project",
  "stagingDir": ".devlink",
  "staged": [
    { "name": "@scope/core", "version": "1.0.0", "path": ".devlink/@scope/core" },
    { "name": "@scope/http", "version": "1.0.0", "path": ".devlink/@scope/http" }
  ],
  "relinked": [
    {
      "package": "@scope/http",
      "dep": "@scope/core",
      "from": "^1.0.0",
      "to": "file:../@scope/core"
    }
  ]
}
```

### Human Mode (default)

```
── Stage ──
  Staged 2 packages to .devlink/
  Re-linked 1 internal dependencies
```

## Internal Dependency Relinking

When staged packages depend on each other, their `package.json` dependencies are rewritten to `file:` relative paths. This ensures npm resolves them locally instead of from the registry.

A dependency is relinked when:
- The dependency name matches another staged package
- The staged version satisfies the dependency's semver range

Only `dependencies` and `peerDependencies` are relinked.

## Errors

### Invalid Plan Input

```
✗ Stage failed: Invalid plan JSON
```

The input is not valid plan output. Ensure you're piping from `dev-link plan --json`.

### Store Path Not Found

```
✗ Stage failed: Store path not found: /home/user/.devlink/namespaces/global/@scope/core/1.0.0
```

The package was removed from the store after planning. Re-run `dev-link plan`.

## See Also

- [Plan Command](plan.md) - Previous step: produce installation plan
- [Apply Command](apply.md) - Next step: inject and hydrate
- [Install Command](install.md) - Full pipeline orchestrator
