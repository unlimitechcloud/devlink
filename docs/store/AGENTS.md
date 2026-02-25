# Store — Agent Guide

Documentation for DevLink's local package store internals.

## Documents

| Document | Description |
|----------|-------------|
| `structure.md` | Store directory layout, registry.json, installations.json |
| `namespaces.md` | Namespace isolation, precedence, resolution order |
| `locking.md` | File locking, concurrency, stale lock detection |

## Key Concepts

- Default store location: `~/.devlink/`
- Custom location: `--repo <path>` or `DEVLINK_REPO` env var
- `global` namespace is reserved and cannot be deleted
- Write operations acquire exclusive locks (30s timeout, 100ms retry)
- Registry tracks packages with MD5 content signatures
- Installations tracks which consumer projects use which packages

## Lock Requirements

| Operation | Lock | Reason |
|-----------|------|--------|
| `publish`, `push`, `install`, `remove` | ✓ | Modifies registry/files |
| `verify --fix`, `prune`, `consumers --prune` | ✓ | Modifies registry/installations |
| `list`, `resolve`, `verify`, `consumers` | ✗ | Read-only |
