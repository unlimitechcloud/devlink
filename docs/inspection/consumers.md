# Consumers Command

Lists projects that have installed packages from the DevLink store.

## Usage

```bash
devlink consumers [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-p, --package <name>` | Filter by package name |
| `-n, --namespace <name>` | Filter by namespace |
| `--prune` | Remove projects that no longer exist |
| `--flat` | Use flat output format |
| `--repo <path>` | Use custom repo path |

## Description

The `consumers` command shows which projects have installed packages from the store. This information is tracked in `installations.json` and is used by the `push` command to update consumers.

## Examples

### List All Consumers

```bash
devlink consumers
```

Output:
```
📦 Consumer Projects

/home/user/project-a
├── @scope/core@1.0.0 (global)
├── @scope/utils@1.0.0 (global)
└── Registered: 2026-02-12T10:00:00Z

/home/user/project-b
├── @scope/core@1.0.0 (feature-v2)
└── Registered: 2026-02-12T11:00:00Z

Total: 2 projects, 3 installations
```

### Filter by Package

```bash
devlink consumers -p @scope/core
```

Shows only projects that have installed `@scope/core`.

### Filter by Namespace

```bash
devlink consumers -n feature-v2
```

Shows only projects using packages from the `feature-v2` namespace.

### Flat Output

```bash
devlink consumers --flat
```

Output:
```
/home/user/project-a  @scope/core@1.0.0      global
/home/user/project-a  @scope/utils@1.0.0     global
/home/user/project-b  @scope/core@1.0.0      feature-v2
```

### Prune Dead Projects

Remove projects that no longer exist on disk:

```bash
devlink consumers --prune
```

Output:
```
🧹 Pruning dead projects...

Removed: /home/user/deleted-project
  - @scope/core@1.0.0 (global)

Pruned 1 project(s)
```

## Consumer Tracking

Projects become consumers when they run `devlink install`. The installation is recorded with:

- Project path
- Installed packages
- Package versions
- Source namespaces
- Package signatures
- Installation timestamp

## Use Cases

### Before Publishing Breaking Changes

Check who would be affected:

```bash
devlink consumers -p @scope/core
```

### Verify Push Targets

See which projects will be updated by `push`:

```bash
# Publish to feature-v2
devlink publish -n feature-v2

# Check who uses feature-v2
devlink consumers -n feature-v2
```

### Clean Up Stale Data

Remove references to deleted projects:

```bash
devlink consumers --prune
```

### Audit Package Usage

See all projects using a specific package:

```bash
devlink consumers -p @scope/core --flat | wc -l
```

## Data Location

Consumer data is stored in `~/.devlink/installations.json`:

```json
{
  "version": "1.0.0",
  "projects": {
    "/home/user/project-a": {
      "registered": "2026-02-12T10:00:00Z",
      "packages": {
        "@scope/core": {
          "version": "1.0.0",
          "namespace": "global",
          "signature": "6761ca1f...",
          "installedAt": "2026-02-12T10:05:00Z"
        }
      }
    }
  }
}
```

## Notes

- The `--prune` flag requires a lock (modifies `installations.json`)
- Projects are automatically registered during `devlink install`
- Projects are not automatically unregistered when deleted

## See Also

- [Push Command](../publishing/push.md) - How push uses consumer data
- [Install Command](../installation/install.md) - How projects become consumers
- [Store Structure](../store/structure.md) - Where consumer data is stored
