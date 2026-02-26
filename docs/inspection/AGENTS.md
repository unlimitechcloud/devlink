# Inspection — Agent Guide

Commands for inspecting the DevLink store and package resolution.

## Commands

| Command | Description | Docs |
|---------|-------------|------|
| `dev-link list` | List packages in the store | `list.md` |
| `dev-link resolve` | Debug package resolution across namespaces | `resolve.md` |
| `dev-link consumers` | List projects that consume packages | `consumers.md` |

## When to Use

- `list` — See what's in the store, filter by namespace or package scope
- `resolve` — Debug why a package resolves from a specific namespace
- `consumers` — Find which projects use a package, clean up dead entries

## Output Formats

All three commands support `--flat` for machine-readable output. `resolve` also supports `--path` for paths only.
