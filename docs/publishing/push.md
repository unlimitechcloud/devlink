# Push Command

Publishes a package and automatically updates all consumer projects.

## Usage

```bash
devlink push [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-n, --namespace <name>` | Target namespace (default: `global`) |
| `--repo <path>` | Use custom repo path |

## Description

The `push` command combines publishing with automatic consumer updates:

1. Publishes the package (same as `devlink publish`)
2. Finds all projects that have installed this package
3. Re-links the package in each consumer project
4. Updates signatures in `installations.json`
5. Updates `devlink.lock` files in consumer projects

This is the recommended command during active development.

## Example

```bash
cd my-sdk/packages/core
devlink push
```

Output:
```
📦 @scope/core@1.0.0 published to global
   Signature: abc123new

🔄 Pushing to 2 project(s):
   ✓ /home/user/project-a
   ✓ /home/user/project-b
```

## How It Works

### 1. Publish Phase

Same as `devlink publish`:
- Copies files to store
- Updates registry
- Generates new signature

### 2. Find Consumers

Searches `installations.json` for projects that:
- Have installed this package
- From the same namespace
- With the same version

### 3. Update Consumers

For each consumer project:
- Verifies project still exists
- Re-creates symlink in `node_modules`
- Updates signature in `installations.json`
- Updates `devlink.lock` file

## Consumer Tracking

Projects become "consumers" when they run `devlink install`. The installation is recorded in `installations.json`:

```json
{
  "projects": {
    "/home/user/project-a": {
      "packages": {
        "@scope/core": {
          "version": "1.0.0",
          "namespace": "global",
          "signature": "old-signature"
        }
      }
    }
  }
}
```

After `push`, the signature is updated to match the new content.

## Use Cases

### Active Development

When developing a library used by multiple projects:

```bash
# Make changes to library
vim src/index.ts

# Build
npm run build

# Push to all consumers
devlink push
```

All consumer projects immediately get the updated code.

### Feature Branch Development

```bash
# Publish to feature namespace
devlink push -n feature-v2

# Only consumers using feature-v2 namespace are updated
```

## Dead Projects

If a consumer project no longer exists (deleted), `push` will:
- Skip that project
- Show a warning
- Continue with other projects

To clean up dead projects:

```bash
devlink consumers --prune
```

## Comparison with Publish

| Aspect | `publish` | `push` |
|--------|-----------|--------|
| Publishes package | ✓ | ✓ |
| Updates consumers | ✗ | ✓ |
| Use case | Initial publish | Active development |

## See Also

- [Publish Command](publish.md) - Publishing without consumer updates
- [Consumers Command](../inspection/consumers.md) - Managing consumer projects
- [Install Command](../installation/install.md) - How projects become consumers
