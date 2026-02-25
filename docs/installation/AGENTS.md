# Installation — Agent Guide

Commands and configuration for installing packages from the DevLink store.

## Documents

| Document | Description |
|----------|-------------|
| `install.md` | Install command usage, options, modes |
| `configuration.md` | `devlink.config.mjs` reference, lifecycle hooks |

## Install Modes

DevLink has two install flows:

- **Direct copy** (default): Copies packages directly to `node_modules/`
- **Staging flow** (`--npm`): Stages packages locally, rewrites internal dependencies to `file:` paths, then runs `npm install`

Use `--npm` when your DevLink packages have internal dependencies on each other.

## Configuration

Projects use `devlink.config.mjs` to define:
- Which packages to manage and their versions per mode (dev/prod)
- Mode detection logic
- Namespace precedence
- Lifecycle hooks (beforeAll, afterAll, beforeEach, afterEach)
