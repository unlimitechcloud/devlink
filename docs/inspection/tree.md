# Tree Command

Displays the monorepo structure detected by DevLink.

## Usage

```bash
dev-link tree [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON for tool consumption |
| `--depth <n>` | Maximum scan depth |
| `--config-name <filename>` | Config file name to detect (e.g. `webforgeai.config.mjs`) |
| `--config-key <key>` | Key within the config export to extract DevLink config from |

## Description

The `tree` command scans the current directory for monorepo structure and displays:

- Install levels (directories with a DevLink config or `package.json`)
- Isolated packages (leaf packages without their own install config)
- Hierarchical relationships between levels

This is used by `dev-link install --recursive` to determine execution order.

## Examples

### Display Tree

```bash
dev-link tree
```

### JSON Output

```bash
dev-link tree --json
```

### Limit Depth

```bash
dev-link tree --depth 2
```

### Custom Config Detection

```bash
dev-link tree --config-name webforgeai.config.mjs --config-key devlink
```

## Output

### Human Mode (default)

```
📂 Monorepo Structure

/home/user/my-project
├── . (install level)
├── packages/api (install level)
└── packages/shared (isolated)
```

### JSON Mode (`--json`)

```json
{
  "root": "/home/user/my-project",
  "installLevels": [
    { "path": "/home/user/my-project", "relativePath": "." },
    { "path": "/home/user/my-project/packages/api", "relativePath": "packages/api" }
  ],
  "isolatedPackages": [
    { "path": "/home/user/my-project/packages/shared", "relativePath": "packages/shared" }
  ]
}
```

## Use Cases

- **Debugging recursive install**: See what DevLink detects before running `install --recursive`
- **CI/CD**: Use `--json` to programmatically determine which directories need installation
- **Monorepo exploration**: Understand the project structure at a glance

## See Also

- [Install Command](../installation/install.md) - Uses tree for `--recursive` mode
- [Configuration](../installation/configuration.md) - Config file detection
