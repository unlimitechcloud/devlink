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
devlink install --dev
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
| `install` | Install packages from store | `--dev`, `--prod`, `-n` |
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

Installs packages from the store based on your `devlink.config.mjs`.

```bash
devlink install                    # Install using default mode
devlink install --dev              # Force dev mode
devlink install --prod             # Force prod mode
devlink install -n feature,global  # Override namespace precedence
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
devlink docs agents                # AI agent guide
devlink docs store/namespaces      # Specific topic
```

## Configuration

### `devlink.config.mjs`

```javascript
export default {
  // Packages to manage
  packages: {
    "@myorg/core": { 
      dev: "1.0.0",      // Version for dev mode
      prod: "1.0.0"      // Version for prod mode (optional)
    },
    "@myorg/utils": { dev: "2.0.0" },
  },
  
  // Dev mode configuration
  dev: () => ({
    manager: "store",              // Use DevLink store
    namespaces: ["feature", "global"],  // Namespace precedence
  }),
  
  // Prod mode configuration (optional)
  prod: () => ({
    manager: "npm",                // Use npm registry
  }),
};
```

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

## Use with AI Agents

DevLink includes comprehensive documentation for AI coding assistants. The `AGENTS.md` file provides a self-contained guide that AI agents can use to understand and operate DevLink.

```bash
# View the AI agent guide
devlink docs agents

# Or read the file directly
cat AGENTS.md
```

AI agents can use DevLink to:
- Publish local packages during development
- Install dependencies from the local store
- Push updates to consumer projects
- Manage namespaces for isolated testing

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

📚 **[Full Documentation](docs/README.md)**

- [Store Structure](docs/store/structure.md) - How the store is organized
- [Namespaces](docs/store/namespaces.md) - Isolation and precedence
- [Configuration](docs/installation/configuration.md) - Config file reference
- [File Locking](docs/store/locking.md) - Concurrent operation safety

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT © [UnlimitechCloud](https://github.com/unlimitechcloud)
