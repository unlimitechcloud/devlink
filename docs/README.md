# DevLink Documentation

Complete documentation for DevLink v2 - Local package development tool with namespaces.

## Documentation Index

### Getting Started
- [Quick Start](../README.md) - Installation and basic usage
- [Configuration](installation/configuration.md) - Project configuration with devlink.config.mjs

### Store & Repository
- [Store Structure](store/structure.md) - How the DevLink store is organized
- [Namespaces](store/namespaces.md) - Isolated package contexts
- [File Locking](store/locking.md) - Concurrency and serialization

### Publishing Packages
- [Publish Command](publishing/publish.md) - Publishing packages to the store
- [Push Command](publishing/push.md) - Publishing and updating consumers

### Installing Packages
- [Install Command](installation/install.md) - Installing packages from the store
- [Configuration](installation/configuration.md) - devlink.config.mjs reference

### Inspecting the Store
- [List Command](inspection/list.md) - Listing packages in the store
- [Resolve Command](inspection/resolve.md) - Debugging package resolution
- [Consumers Command](inspection/consumers.md) - Tracking consumer projects

### Maintenance
- [Remove Command](maintenance/remove.md) - Removing packages and namespaces
- [Verify Command](maintenance/verify.md) - Verifying store integrity
- [Prune Command](maintenance/prune.md) - Cleaning up orphaned packages

### Technical Reference
- [Design Document](DESIGN-namespaces.md) - Technical design and architecture
- [Agent Guide](../AGENTS.md) - Comprehensive guide for AI agents

## Quick Reference

### Global Options

All commands support these options:

| Option | Description |
|--------|-------------|
| `--repo <path>` | Use custom repo path instead of `~/.devlink` |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DEVLINK_REPO` | Custom repo path (alternative to `--repo`) |

### Commands Overview

| Command | Description | Requires Lock |
|---------|-------------|---------------|
| `publish` | Publish package to store | ✓ |
| `push` | Publish and update consumers | ✓ |
| `install` | Install packages from store | ✓ |
| `list` | List packages in store | ✗ |
| `resolve` | Debug package resolution | ✗ |
| `consumers` | List consumer projects | ✗ |
| `remove` | Remove packages/namespaces | ✓ |
| `verify` | Verify store integrity | ✗/✓ |
| `prune` | Remove orphaned packages | ✓ |
