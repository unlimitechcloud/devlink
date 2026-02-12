# Prune Command

Removes orphaned packages from the store.

## Usage

```bash
devlink prune [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-n, --namespace <name>` | Only prune in specific namespace |
| `--dry-run` | Show what would be removed without removing |
| `--repo <path>` | Use custom repo path |

## Description

The `prune` command removes packages that exist on disk but are not in the registry. These "orphaned" packages can occur when:

- A publish operation was interrupted
- Files were manually added to the store
- The registry was corrupted or restored from backup

## Examples

### Prune All Orphans

```bash
devlink prune
```

Output:
```
🧹 Pruning orphaned packages...

Removed:
  ✓ global/@scope/orphan@1.0.0
  ✓ feature-v2/@scope/old-pkg@2.0.0

Pruned 2 package(s), freed 15.2 MB
```

### Dry Run

Preview what would be removed:

```bash
devlink prune --dry-run
```

Output:
```
🧹 Pruning orphaned packages (dry run)...

Would remove:
  - global/@scope/orphan@1.0.0 (5.1 MB)
  - feature-v2/@scope/old-pkg@2.0.0 (10.1 MB)

Would prune 2 package(s), free 15.2 MB

Run without --dry-run to actually remove
```

### Prune Specific Namespace

```bash
devlink prune -n feature-v2
```

Output:
```
🧹 Pruning orphaned packages in 'feature-v2'...

Removed:
  ✓ feature-v2/@scope/old-pkg@2.0.0

Pruned 1 package(s), freed 10.1 MB
```

### No Orphans Found

```bash
devlink prune
```

Output:
```
🧹 Pruning orphaned packages...

No orphaned packages found.
Store is clean ✓
```

## Difference from Verify --fix

| Command | What it does |
|---------|--------------|
| `verify --fix` | Fixes both registry orphans AND disk orphans |
| `prune` | Only removes disk orphans |

Use `verify --fix` for comprehensive cleanup, or `prune` when you specifically want to clean disk orphans.

## Use Cases

### Regular Maintenance

Run periodically to keep the store clean:

```bash
devlink prune --dry-run  # Check first
devlink prune            # Then clean
```

### After Failed Operations

If a publish was interrupted:

```bash
devlink prune
```

### Before Backup

Clean up before backing up the store:

```bash
devlink prune
tar -czf devlink-backup.tar.gz ~/.devlink
```

### Disk Space Recovery

Find and remove orphaned packages to free space:

```bash
devlink prune --dry-run  # See how much space would be freed
devlink prune            # Actually free the space
```

## Safety

The `prune` command only removes packages that are NOT in the registry. Packages that are properly registered will never be removed.

To be extra safe, always use `--dry-run` first:

```bash
devlink prune --dry-run
# Review the output
devlink prune
```

## See Also

- [Verify Command](verify.md) - Check and fix store integrity
- [Remove Command](remove.md) - Explicitly remove packages
- [Store Structure](../store/structure.md) - Understanding the store layout
