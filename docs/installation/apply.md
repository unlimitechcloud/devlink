# Apply Command

Composite command that orchestrates `inject` → `hydrate`.

## Usage

```bash
dev-link apply [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--stage <path>` | Path to stage JSON file (reads from stdin if omitted) |
| `--plan <path>` | Path to plan JSON file |
| `--npm-ignore-scripts` | Pass `--ignore-scripts` to npm install |
| `--json` | Output structured JSON to stdout |

## Description

The `apply` command orchestrates two sub-commands in sequence:

1. **inject** — rewrites `package.json` with dependency references
2. **hydrate** — runs npm install + link

Fail-fast behavior: if `inject` fails, `hydrate` is skipped and the command reports `success: false`.

## Input

Requires both stage output and plan output:

- **Stage**: via `--stage` file or stdin
- **Plan**: via `--plan` file

## Examples

### With Files

```bash
dev-link apply --stage /tmp/stage.json --plan /tmp/plan.json
```

### Piped from Stage

```bash
dev-link stage --plan /tmp/plan.json --json | dev-link apply --plan /tmp/plan.json --json
```

### Full Pipeline via Shell

```bash
dev-link plan --mode dev --json > /tmp/plan.json
dev-link stage --plan /tmp/plan.json --json | dev-link apply --plan /tmp/plan.json --json
```

### Skip Scripts

```bash
dev-link apply --stage /tmp/stage.json --plan /tmp/plan.json --npm-ignore-scripts
```

## Output

### JSON Mode (`--json`)

```json
{
  "projectPath": "/home/user/my-project",
  "success": true,
  "trace": {
    "inject": {
      "projectPath": "/home/user/my-project",
      "modified": "package.json",
      "injected": [
        { "name": "@scope/core", "target": "dependencies", "value": "file:.devlink/@scope/core" }
      ],
      "registry": [
        { "name": "@scope/utils", "target": "dependencies", "value": "2.0.0" }
      ],
      "removed": ["@scope/ci-tools"],
      "synthetic": ["@myorg/sst"]
    },
    "hydrate": {
      "projectPath": "/home/user/my-project",
      "success": true,
      "trace": {
        "npm-install": {
          "projectPath": "/home/user/my-project",
          "exitCode": 0,
          "args": ["install", "--no-audit", "--legacy-peer-deps"]
        },
        "link": {
          "projectPath": "/home/user/my-project",
          "linked": [],
          "failed": []
        }
      }
    }
  }
}
```

### Human Mode (default)

```
── Apply ──
  Inject: 2 injected, 1 removed
  npm install exit code: 0
  0 linked, 0 failed
```

## Fail-Fast Behavior

| inject result | hydrate executed? | success |
|--------------|-------------------|---------|
| Success | Yes | Depends on hydrate |
| Failure | No (skipped) | `false` |

## Pipeline Interception

The `apply` command is the natural interception point for external tools. After `plan` and `stage` complete, an external tool can inspect `.devlink/` contents (e.g., read `peerDependencies` from staged packages) before calling `apply`:

```bash
dev-link plan --mode dev --json > /tmp/plan.json
dev-link stage --plan /tmp/plan.json --json > /tmp/stage.json

# External tool inspects staged packages here...
my-tool check-peers --stage /tmp/stage.json

# Continue pipeline
dev-link apply --stage /tmp/stage.json --plan /tmp/plan.json --json
```

## See Also

- [Inject Command](inject.md) - Sub-command: rewrite package.json
- [Hydrate Command](hydrate.md) - Sub-command: npm install + link
- [Stage Command](stage.md) - Previous step: stage packages
- [Install Command](install.md) - Full pipeline orchestrator
