# DevLink — Agent Guide

Complete reference for AI agents to use DevLink, a local package development and linking tool with namespace support.

## What is DevLink?

DevLink manages npm packages during local development. Instead of publishing to npm registry, packages are published to a local store and linked into consumer projects. This enables instant updates, namespace isolation for feature branches, and automatic propagation of changes.

Binary: `devlink`

## Command Quick Reference

| Command | Purpose | Docs |
|---------|---------|------|
| `publish` | Publish package to store | `docs publishing/publish.md` |
| `push` | Publish and update all consumers | `docs publishing/push.md` |
| `install` | Install packages from store | `docs installation/install.md` |
| `list` | List packages in store | `docs inspection/list.md` |
| `resolve` | Debug package resolution | `docs inspection/resolve.md` |
| `consumers` | List consumer projects | `docs inspection/consumers.md` |
| `remove` | Remove packages/namespaces | `docs maintenance/remove.md` |
| `verify` | Verify store integrity | `docs maintenance/verify.md` |
| `prune` | Remove orphaned packages | `docs maintenance/prune.md` |
| `docs` | Browse embedded documentation | — |

## Global Options

| Option | Description |
|--------|-------------|
| `--repo <path>` | Use custom store path instead of `~/.devlink` |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

Environment: `DEVLINK_REPO` can be used instead of `--repo`.

## Core Concepts

- **Store**: Centralized repository at `~/.devlink/` for locally published packages
- **Namespaces**: Isolated containers (`global` is default and reserved). Same package@version can exist in multiple namespaces
- **Registry**: `registry.json` indexes all published packages with signatures
- **Installations**: `installations.json` tracks which projects consume which packages
- **File Locking**: Write operations acquire exclusive locks to prevent corruption

For details on store internals, see `docs store/`.

## Documentation Navigation

This documentation follows a specialization hierarchy:

```
docs/AGENTS.md (this file)       → Overview, commands, concepts
docs/store/AGENTS.md             → Store internals: structure, namespaces, locking
docs/publishing/AGENTS.md        → Publishing: publish, push
docs/installation/AGENTS.md      → Installation: install, configuration
docs/inspection/AGENTS.md        → Inspection: list, resolve, consumers
docs/maintenance/AGENTS.md       → Maintenance: remove, verify, prune
```

Each directory has an `agents.md` with context for that section, plus individual `.md` files for specific topics.

## Common Workflows

### Publish and Propagate

```bash
cd /path/to/my-library
devlink publish              # Publish to store
devlink push                 # Publish + update all consumers
```

### Install in Consumer Project

```bash
devlink install --dev        # Install from store using devlink.config.mjs
devlink install --dev --npm  # With npm dependency resolution
```

### Feature Branch Isolation

```bash
devlink publish -n feature-v2           # Publish to feature namespace
devlink install --dev -n feature-v2,global  # Consumer resolves feature first
devlink remove feature-v2               # Clean up after merge
```

### Store Maintenance

```bash
devlink verify               # Check store integrity
devlink verify --fix         # Auto-fix issues
devlink prune --dry-run      # Preview orphan cleanup
devlink consumers --prune    # Remove dead consumer entries
```

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `not found in namespaces` | Package not published | Publish first or check namespace config |
| `package.json not found` | Wrong directory | Run from directory with package.json |
| `Cannot delete reserved namespace` | Trying to remove `global` | Remove individual packages instead |
| `Lock timeout after 30000ms` | Another process holds lock | Wait or check for stale locks |
