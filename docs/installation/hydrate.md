# Hydrate Command

Composite command that orchestrates `npm-install` → `link`.

## Usage

```bash
dev-link hydrate [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--plan <path>` | Path to plan JSON file (for link entries) |
| `--npm-ignore-scripts` | Pass `--ignore-scripts` to npm install |
| `--json` | Output structured JSON to stdout |

## Description

The `hydrate` command orchestrates two sub-commands in sequence:

1. **npm-install** — runs `npm install` to resolve all dependencies
2. **link** — runs `npm link` for packages with local path references

Fail-fast behavior: if `npm-install` fails (non-zero exit code), `link` is skipped and the command reports `success: false`.

## Examples

### Basic

```bash
dev-link hydrate --plan /tmp/plan.json
```

### Skip Scripts

```bash
dev-link hydrate --plan /tmp/plan.json --npm-ignore-scripts
```

### JSON Mode

```bash
dev-link hydrate --plan /tmp/plan.json --json
```

## Output

### JSON Mode (`--json`)

```json
{
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
      "linked": [
        { "name": "@scope/sdk", "path": "/home/user/sdk" }
      ],
      "failed": []
    }
  }
}
```

Failed example (npm-install fails, link skipped):

```json
{
  "projectPath": "/home/user/my-project",
  "success": false,
  "trace": {
    "npm-install": {
      "projectPath": "/home/user/my-project",
      "exitCode": 1,
      "args": ["install", "--no-audit", "--legacy-peer-deps"]
    },
    "link": null
  }
}
```

### Human Mode (default)

```
── Hydrate ──
  npm install exit code: 0
  1 linked, 0 failed
```

## Fail-Fast Behavior

| npm-install result | link executed? | success |
|-------------------|----------------|---------|
| exit 0 | Yes | Depends on link results |
| exit non-zero | No (skipped) | `false` |

## See Also

- [npm-install Command](npm-install.md) - Sub-command: npm install
- [Link Command](link.md) - Sub-command: npm link
- [Apply Command](apply.md) - Composite: inject → hydrate
- [Install Command](install.md) - Full pipeline orchestrator
