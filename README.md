# @unlimitechcloud/devlink

A modern local package development and linking tool with namespace support, designed for monorepos and multi-project workflows.

[![npm version](https://img.shields.io/npm/v/@unlimitechcloud/devlink.svg)](https://www.npmjs.com/package/@unlimitechcloud/devlink)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why DevLink?

When developing multiple packages locally, you need a way to test changes across projects without publishing to npm. DevLink provides:

- **Namespace isolation** - Different projects can use different versions or variants of the same package without conflicts
- **Multi-version support** - Test multiple versions of the same package simultaneously across different projects
- **Automatic consumer updates** - Push changes to all dependent projects with one command
- **Declarative configuration** - Define dependencies in a config file, not CLI flags

## Installation

```bash
# Global installation (recommended)
npm install -g @unlimitechcloud/devlink

# Or use with npx
npx @unlimitechcloud/devlink <command>
```

## Quick Start

### 1. Publish Your Library

```bash
cd my-library
devlink publish
```

This copies your package to the DevLink store (`~/.devlink/namespaces/global/`).

### 2. Configure Your Consumer Project

Create `devlink.config.mjs` in your project root:

```javascript
export default {
  packages: {
    "@myorg/my-library": { dev: "1.0.0" },
    "@myorg/utils": { dev: "2.0.0" },
  },
  dev: () => ({
    manager: "store",
    namespaces: ["global"],
  }),
};
```

### 3. Install from Store

```bash
cd my-project
devlink install --dev --npm
```

DevLink copies the packages from the store to your `node_modules`.

### 4. Push Updates

After making changes to your library:

```bash
cd my-library
devlink push
```

This publishes the new version AND automatically updates all consumer projects.

## Commands Reference

| Command | Description | Common Options |
|---------|-------------|----------------|
| `publish` | Publish package to the store | `-n, --namespace` |
| `push` | Publish and update all consumers | `-n, --namespace` |
| `install` | Install packages from store/registry | `-m, --mode`, `--dev`, `--npm` |
| `list` | List packages in store | `-n`, `-p`, `--flat` |
| `resolve` | Debug package resolution | `-n, --namespaces` |
| `consumers` | List/manage consumer projects | `--prune` |
| `remove` | Remove packages or namespaces | `-n, --namespace` |
| `verify` | Check store integrity | `--fix` |
| `prune` | Remove orphaned packages | `--dry-run` |
| `docs` | Display embedded documentation | `<topic>` |

### Command Details

#### `devlink publish`

Publishes the current package to the DevLink store.

```bash
devlink publish                    # Publish to global namespace
devlink publish -n feature-v2      # Publish to feature-v2 namespace
devlink publish --repo ~/custom    # Use custom store location
```

#### `devlink push`

Publishes and automatically updates all consumer projects that use this package.

```bash
devlink push                       # Publish and update consumers
devlink push -n feature-v2         # Push to specific namespace
```

#### `devlink install`

Installs packages from the store or registry based on your `devlink.config.mjs`.

```bash
devlink install                        # Install using default/detected mode
devlink install --mode dev --npm       # Dev mode with npm integration
devlink install --mode remote --npm    # Remote mode (registry resolution)
devlink install --dev --npm            # Shorthand for --mode dev
devlink install -n feature,global      # Override namespace precedence
```

#### `devlink list`

Lists all packages in the store.

```bash
devlink list                       # Tree view by namespace
devlink list --flat                # Flat output (for scripting)
devlink list -n global             # Filter by namespace
devlink list -p @myorg             # Filter by scope
devlink list -p @myorg/core        # Filter by package
```

#### `devlink resolve`

Shows how packages would be resolved given namespace precedence.

```bash
devlink resolve @myorg/core@1.0.0
devlink resolve @myorg/core@1.0.0 -n feature,global
```

#### `devlink consumers`

Lists projects that have installed packages from the store.

```bash
devlink consumers                  # List all consumers
devlink consumers -p @myorg/core   # Filter by package
devlink consumers --prune          # Remove dead projects
```

#### `devlink remove`

Removes packages, versions, or entire namespaces.

```bash
devlink remove @myorg/core@1.0.0   # Remove specific version
devlink remove @myorg/core         # Remove all versions
devlink remove feature-v2          # Remove entire namespace
```

#### `devlink docs`

Access embedded documentation from the CLI.

```bash
devlink docs                       # Show documentation tree
devlink docs agents.md             # AI agent guide (root)
devlink docs store/namespaces.md   # Specific topic
devlink docs store/agents.md       # Store section agent guide
```

## Configuration

### `devlink.config.mjs`

```javascript
export default {
  // Packages to manage — versions per mode
  packages: {
    "@myorg/core": { dev: "1.0.0", remote: "1.0.0" },
    "@myorg/utils": { dev: "2.0.0", remote: "1.5.0" },
    "@myorg/dev-tools": { dev: "1.0.0" },  // dev only — removed in remote mode
  },
  
  // Dev mode — uses local DevLink store
  dev: () => ({
    manager: "store",
    namespaces: ["feature", "global"],
    peerOptional: ["@myorg/*"],
  }),
  
  // Remote mode — uses npm registry (e.g. GitHub Packages)
  remote: () => ({
    manager: "npm",
  }),

  // Auto-detect mode when no --mode flag is provided
  detectMode: (ctx) => {
    if (ctx.env.NODE_ENV === "development") return "dev";
    return "remote";
  },
};
```

### peerOptional

When your packages have internal dependencies (e.g., `@myorg/core` depends on `@myorg/utils`), npm will try to resolve them from the registry during `npm install`. If these packages aren't published yet, npm fails.

The `peerOptional` option solves this by transforming matching dependencies to optional peer dependencies in the copied packages. This tells npm not to resolve them from the registry.

```javascript
dev: () => ({
  manager: "store",
  peerOptional: ["@myorg/*"],  // All @myorg packages become optional peers
})
```

**Note:** Only the copies in `node_modules` are modified. The original packages in the store remain unchanged.

### Global Options

```bash
--repo <path>     # Use custom store location (default: ~/.devlink)
-h, --help        # Show help
-v, --version     # Show version
```

Environment variable: `DEVLINK_REPO` can also set the store location.

## Namespaces

Namespaces allow different projects to use different variants of the same package without conflicts. Each namespace is an isolated context in the store:

```bash
# Feature branch development
devlink publish -n feature-auth

# Team-specific packages
devlink publish -n team-platform

# Environment-specific
devlink publish -n staging
```

**Use cases:**
- Test experimental changes in one project while others use stable versions
- Multiple developers working on different features of the same package
- A/B testing different implementations

Resolution follows namespace precedence:
```javascript
namespaces: ["feature-auth", "global"]
// First looks in feature-auth, falls back to global
```

## Example Workflows

### Feature Branch Development

```bash
# Developer A: Working on auth feature
cd packages/auth
devlink publish -n feature-auth

# Developer B: Testing auth changes
# devlink.config.mjs: namespaces: ["feature-auth", "global"]
devlink install --dev

# After feature is merged
devlink publish                    # Publish to global
devlink remove feature-auth        # Clean up
```

### Monorepo Development

```bash
# Publish all packages
cd packages/core && devlink publish
cd packages/utils && devlink publish
cd packages/ui && devlink publish

# Consumer app
cd apps/web
devlink install --dev

# After changes to core
cd packages/core
devlink push                       # Updates apps/web automatically
```

### Using DevLink as Default Install Command

Replace `npm install` with DevLink during development using npm lifecycle hooks:

```json
{
  "scripts": {
    "dev:install": "devlink install --mode dev --npm",
    "remote:install": "devlink install --mode remote --npm"
  }
}
```

- `dev:install` — resolves packages from the local DevLink store via staging + `file:` protocol
- `remote:install` — injects exact versions into `package.json` for npm to resolve from a configured registry (e.g. GitHub Packages)

## Use with AI Agents

DevLink includes comprehensive, hierarchical documentation designed for AI coding assistants. The documentation is embedded in the CLI and organized by section, each with its own agent guide.

```bash
# View the root AI agent guide
devlink docs agents.md

# Section-specific guides
devlink docs store/agents.md
devlink docs publishing/agents.md
devlink docs installation/agents.md
```

AI agents can also read the development guide at `AGENTS.md` in the project root for codebase internals.

## Store Structure

```
~/.devlink/
├── namespaces/
│   ├── global/
│   │   └── @myorg/
│   │       └── core/
│   │           └── 1.0.0/
│   │               ├── package.json
│   │               └── dist/
│   └── feature-v2/
│       └── ...
├── registry.json          # Package index
├── installations.json     # Consumer tracking
└── .lock                  # File locking
```

## Documentation

📚 Access documentation directly from the CLI:

```bash
devlink docs                       # Browse documentation tree
devlink docs agents.md             # Complete AI agent guide
devlink docs store                 # List store documents
devlink docs store/namespaces.md   # Specific topic
```

Each section has its own agent guide (`agents.md`) with context for that area:
- `store/` — Store structure, namespaces, locking
- `publishing/` — Publish and push commands
- `installation/` — Install command and configuration
- `inspection/` — List, resolve, consumers
- `maintenance/` — Remove, verify, prune

### Full Index

- **Store**
  - [Structure](docs/store/structure.md) — Store directory layout and registry
  - [Namespaces](docs/store/namespaces.md) — Namespace isolation and precedence
  - [Locking](docs/store/locking.md) — File locking and concurrency
- **Publishing**
  - [Publish](docs/publishing/publish.md) — Publishing packages to the store
  - [Push](docs/publishing/push.md) — Publishing and updating all consumers
- **Installation**
  - [Install](docs/installation/install.md) — Install command, flows, and bin linking
  - [Configuration](docs/installation/configuration.md) — devlink.config.mjs reference
- **Inspection**
  - [List](docs/inspection/list.md) — Listing packages in the store
  - [Resolve](docs/inspection/resolve.md) — Debugging package resolution
  - [Consumers](docs/inspection/consumers.md) — Consumer project tracking
- **Maintenance**
  - [Remove](docs/maintenance/remove.md) — Removing packages and namespaces
  - [Verify](docs/maintenance/verify.md) — Verifying store integrity
  - [Prune](docs/maintenance/prune.md) — Removing orphaned packages

## Changelog

### Latest: [1.2.0] - 2026-02-26

- Dynamic `--mode <name>` flag for custom install modes
- Registry package injection for `manager: "npm"` (e.g. GitHub Packages)
- Package removal for mode-specific package sets
- `detectMode()` config function for automatic mode selection
- `--dev`/`--prod` kept as backward-compatible shorthands
- `prod` factory no longer required in configuration

📄 [Full Changelog](CHANGELOG.md)

## Feedback

We welcome feedback, suggestions, and ideas for improvement. Please open an [issue](https://github.com/unlimitechcloud/devlink/issues) to share your thoughts.

Note: This project does not accept code contributions via pull requests.

## About This Project

This tool was built following the principles defined in the whitepaper **"A Formal Definition of AI-First"** by [Unlimitech Cloud LLC](https://unlimitech.cloud).

📄 [Read the Whitepaper](https://ulcl.link/whpp-ai-first) | [More Whitepapers](https://ulcl.link/whpp)

The whitepaper provides a formal functional definition that enables seamless integration with AI coding assistants and autonomous agents—making tools like DevLink naturally AI-ready.

This project represents Unlimitech Cloud LLC's commitment to knowledge sharing: contributing frameworks and practical tools that help organizations navigate complex challenges. We believe sharing knowledge openly strengthens the broader ecosystem and creates value for everyone.

## License

MIT © [Unlimitech Cloud LLC](https://unlimitech.cloud)
