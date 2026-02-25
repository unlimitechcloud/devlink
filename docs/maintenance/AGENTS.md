# Maintenance — Agent Guide

Commands for maintaining the DevLink store.

## Commands

| Command | Description | Docs |
|---------|-------------|------|
| `devlink remove` | Remove packages, versions, or namespaces | `remove.md` |
| `devlink verify` | Verify store integrity | `verify.md` |
| `devlink prune` | Remove orphaned packages from disk | `prune.md` |

## When to Use

- `remove` — Clean up old packages, versions, or feature namespaces after merge
- `verify` — Check for inconsistencies between registry and disk (orphans, signature mismatches)
- `prune` — Remove files on disk that aren't tracked in the registry

## Safety

- `global` namespace cannot be removed
- `prune --dry-run` previews what would be removed
- `verify` is read-only by default; `--fix` modifies the registry
