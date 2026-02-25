# Publishing — Agent Guide

Commands for publishing packages to the DevLink store.

## Commands

| Command | Description | Docs |
|---------|-------------|------|
| `devlink publish` | Publish package to store | `publish.md` |
| `devlink push` | Publish and update all consumer projects | `push.md` |

## When to Use

- `publish` — When you only need to update the store (consumers install manually)
- `push` — During active development, to automatically propagate changes to all consumers

## Requirements

`package.json` must have `name`, `version`, and `files` fields. The `files` field determines which files are copied to the store.

## Namespace Support

Both commands accept `-n, --namespace <name>` to publish to a specific namespace (default: `global`). Namespaces are created automatically on first publish.
