# Verify Command

Verifies the integrity of the DevLink store.

## Usage

```bash
dev-link verify [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--fix` | Automatically fix issues found |
| `--repo <path>` | Use custom repo path |

## Description

The `verify` command checks for inconsistencies between:

- The registry (`registry.json`)
- The actual files on disk

## Checks Performed

### Orphans in Registry

Entries in the registry that don't have corresponding files on disk.

**Cause**: Files were manually deleted or corrupted.

**Fix**: Remove the registry entry.

### Orphans on Disk

Files on disk that don't have corresponding registry entries.

**Cause**: Publish was interrupted, or files were manually added.

**Fix**: Remove the orphaned files.

### Signature Mismatches

Package content doesn't match the recorded signature.

**Cause**: Files were modified after publishing.

**Fix**: Recalculate and update signature.

## Examples

### Check Store Integrity

```bash
dev-link verify
```

Output (healthy store):
```
🔍 Verifying store integrity...

global/
  ✓ @scope/core@1.0.0
  ✓ @scope/core@2.0.0
  ✓ @scope/utils@1.0.0

feature-v2/
  ✓ @scope/core@1.0.0

─────────────────────────────────
Summary:
  ✓ Valid:                4
  ✗ Orphans in registry:  0
  ⚠ Orphans on disk:      0

Store is healthy ✓
```

### Store with Issues

```bash
dev-link verify
```

Output:
```
🔍 Verifying store integrity...

global/
  ✓ @scope/core@1.0.0
  ✗ @scope/data@1.0.0 - In registry, not on disk
  ✓ @scope/utils@1.0.0
  ⚠ @scope/orphan@1.0.0 - On disk, not in registry

─────────────────────────────────
Summary:
  ✓ Valid:                2
  ✗ Orphans in registry:  1
  ⚠ Orphans on disk:      1

Run 'dev-link verify --fix' to repair
```

### Auto-Fix Issues

```bash
dev-link verify --fix
```

Output:
```
🔍 Verifying and fixing store...

Fixing orphans in registry:
  ✓ Removed @scope/data@1.0.0 from registry

Fixing orphans on disk:
  ✓ Removed @scope/orphan@1.0.0 from disk

─────────────────────────────────
Fixed 2 issue(s)
Store is now healthy ✓
```

## When to Use

### After System Crash

If DevLink or your system crashed during an operation:

```bash
dev-link verify --fix
```

### Periodic Maintenance

Run periodically to ensure store health:

```bash
dev-link verify
```

### Before Important Operations

Verify before publishing critical packages:

```bash
dev-link verify
dev-link publish
```

### After Manual File Operations

If you manually modified files in the store:

```bash
dev-link verify --fix
```

## Lock Requirement

| Mode | Requires Lock |
|------|---------------|
| `verify` | No |
| `verify --fix` | Yes |

The `--fix` flag modifies the store, so it requires an exclusive lock.

## See Also

- [Prune Command](prune.md) - Remove orphaned packages
- [Store Structure](../store/structure.md) - Understanding the store layout
- [File Locking](../store/locking.md) - How locking works
