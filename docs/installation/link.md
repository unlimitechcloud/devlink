# Link Command

Executes `npm link` for packages with the `link` attribute in the installation plan.

## Usage

```bash
dev-link link [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--plan <path>` | Path to plan JSON file (reads from stdin if omitted) |
| `--json` | Output structured JSON to stdout |

## Description

The `link` command:

1. Reads plan output to get link package entries
2. For each link package: spawns `npm link <resolved-path>`
3. Collects successes and failures independently
4. Reports structured output with `linked[]` and `failed[]`

The command is resilient — it processes all entries even if individual links fail. Each failure is recorded with its exit code but does not prevent other links from being attempted.

## Input

Requires plan output (for the `packages.link` entries):

- **File**: `--plan /path/to/plan.json`
- **Stdin**: piped from a previous command

## Examples

### With Plan File

```bash
dev-link link --plan /tmp/plan.json
```

### Piped

```bash
dev-link plan --mode dev --json | dev-link link --json
```

### JSON Mode

```bash
dev-link link --plan /tmp/plan.json --json
```

## Output

### JSON Mode (`--json`)

```json
{
  "projectPath": "/home/user/my-project",
  "linked": [
    { "name": "@scope/sdk", "path": "/home/user/sdk" }
  ],
  "failed": [
    { "name": "@scope/broken", "path": "/home/user/broken", "exitCode": 1 }
  ]
}
```

### Human Mode (default)

```
── Link ──
  @scope/sdk → /home/user/sdk ✓
  @scope/broken → /home/user/broken ✗ (exit 1)
  1 linked, 1 failed
```

## Resilience

Unlike most commands, `link` does not fail-fast. If one package fails to link, the remaining packages are still processed. This ensures partial success is possible — you get as many links as possible even when some paths are invalid.

## Errors

### Invalid Plan Input

```
✗ Link failed: Invalid plan JSON
```

### No Link Entries

When the plan has no link packages, the command succeeds with empty arrays:

```json
{
  "projectPath": "/home/user/my-project",
  "linked": [],
  "failed": []
}
```

## See Also

- [npm-install Command](npm-install.md) - Previous step: npm install
- [Hydrate Command](hydrate.md) - Composite: npm-install → link
- [Configuration](configuration.md) - Defining link packages
