# npm-install Command

Executes `npm install` in the project directory.

## Usage

```bash
dev-link npm-install [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--npm-ignore-scripts` | Pass `--ignore-scripts` to npm install |
| `--json` | Output structured JSON to stdout |

## Description

The `npm-install` command:

1. Spawns `npm install --no-audit --legacy-peer-deps` in the project directory
2. Optionally passes `--ignore-scripts` when `--npm-ignore-scripts` is set
3. Routes npm stdout/stderr to stderr when `--json` is active (keeps stdout clean for JSON)
4. Reports the exit code in structured output

This is a thin wrapper around npm that integrates with the pipeline's output routing. It does not throw on non-zero exit codes — it reports them in the output for upstream commands to handle.

## Examples

### Basic

```bash
dev-link npm-install
```

### Skip Lifecycle Scripts

```bash
dev-link npm-install --npm-ignore-scripts
```

### JSON Mode

```bash
dev-link npm-install --json
```

In JSON mode, npm's own output (progress, warnings, etc.) goes to stderr. Only the structured result goes to stdout.

## Output

### JSON Mode (`--json`)

```json
{
  "projectPath": "/home/user/my-project",
  "exitCode": 0,
  "args": ["install", "--no-audit", "--legacy-peer-deps"]
}
```

Non-zero exit code example:

```json
{
  "projectPath": "/home/user/my-project",
  "exitCode": 1,
  "args": ["install", "--no-audit", "--legacy-peer-deps"]
}
```

### Human Mode (default)

```
── npm install ──
  Exit code: 0
```

npm output is inherited directly to the terminal in human mode.

## Exit Code Handling

The command does not throw on npm failure. It always reports the exit code in its output. Composite commands (hydrate, apply, install) use this to implement fail-fast behavior.

| Exit Code | Meaning |
|-----------|---------|
| `0` | Success |
| `1` | npm error (dependency resolution, network, etc.) |

## Errors

### npm Not Found

```
✗ npm-install failed: npm not found in PATH
```

Ensure npm is installed and available.

## See Also

- [Link Command](link.md) - Next step: npm link for local packages
- [Hydrate Command](hydrate.md) - Composite: npm-install → link
- [Install Command](install.md) - Full pipeline orchestrator
