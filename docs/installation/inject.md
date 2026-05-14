# Inject Command

Rewrites the project's `package.json` with `file:` protocols for staged packages and version strings for registry packages.

## Usage

```bash
dev-link inject [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--stage <path>` | Path to stage JSON file (reads from stdin if omitted) |
| `--plan <path>` | Path to plan JSON file |
| `--json` | Output structured JSON to stdout |

## Description

The `inject` command:

1. Reads stage output to know which packages are staged and where
2. Reads plan output to know registry packages, removals, and flags
3. Rewrites `package.json`:
   - Staged packages → `file:` entries (e.g. `"file:.devlink/@scope/core"`)
   - Registry packages → version strings (e.g. `"1.0.0"`)
   - Packages marked for removal → deleted from dependencies
   - Synthetic packages → skipped (not injected into `package.json`)
4. Respects the `dev` flag for `devDependencies` vs `dependencies` placement

## Input

Requires both stage output and plan output:

- **Stage**: via `--stage` file or stdin
- **Plan**: via `--plan` file

## Examples

### Pipe from Stage

```bash
dev-link plan --mode dev --json > /tmp/plan.json
dev-link stage --plan /tmp/plan.json --json | dev-link inject --plan /tmp/plan.json --json
```

### Use Files

```bash
dev-link inject --stage /tmp/stage.json --plan /tmp/plan.json --json
```

## Output

### JSON Mode (`--json`)

```json
{
  "projectPath": "/home/user/my-project",
  "modified": "package.json",
  "injected": [
    { "name": "@scope/core", "target": "dependencies", "value": "file:.devlink/@scope/core" },
    { "name": "@scope/test-utils", "target": "devDependencies", "value": "file:.devlink/@scope/test-utils" }
  ],
  "registry": [
    { "name": "@scope/utils", "target": "dependencies", "value": "2.0.0" }
  ],
  "removed": ["@scope/ci-tools"],
  "synthetic": ["@myorg/sst"]
}
```

### Human Mode (default)

```
── Inject ──
  Modified package.json: 3 injected, 1 removed
```

## Package Classification

| Classification | Action | Example |
|---------------|--------|---------|
| Staged (store) | `file:` protocol in dependencies | `"file:.devlink/@scope/core"` |
| Registry | Version string in dependencies | `"1.0.0"` |
| Remove | Deleted from package.json | — |
| Synthetic | Skipped (exists in `.devlink/` only) | — |
| Dev flag | Placed in `devDependencies` | Same value, different section |

## Errors

### Invalid Stage Input

```
✗ Inject failed: Invalid stage JSON
```

### Missing Plan

```
✗ Inject failed: Plan input required (use --plan or provide via context)
```

## See Also

- [Stage Command](stage.md) - Previous step: stage packages
- [Hydrate Command](hydrate.md) - Next step: npm install + link
- [Apply Command](apply.md) - Composite: inject → hydrate
