# Inspection — Agent Guide

Commands for inspecting the DevLink store and package resolution.

## Commands

| Command | Description | Docs |
|---------|-------------|------|
| `dev-link list` | List packages in the store | `list.md` |
| `dev-link resolve` | Debug package resolution across namespaces | `resolve.md` |
| `dev-link consumers` | List projects that consume packages | `consumers.md` |
| `dev-link tree` | Display monorepo structure | `tree.md` |

## When to Use

- `list` — See what's in the store, filter by namespace or package scope
- `resolve` — Debug why a package resolves from a specific namespace
- `consumers` — Find which projects use a package, clean up dead entries
- `tree` — Inspect monorepo structure before running `install --recursive`

## Output Formats

All inspection commands support machine-readable output. `list`, `resolve`, and `consumers` support `--flat`. `tree` supports `--json`.
