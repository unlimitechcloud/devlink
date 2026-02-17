# DevLink - Agent Guide

Complete reference for AI agents to use DevLink, a local package development and linking tool with namespace support.

## What is DevLink?

DevLink is a tool for managing npm packages during local development. Instead of publishing to npm registry, packages are published to a local store and linked into consumer projects. This enables:

- Instant updates during development (no npm publish cycle)
- Multiple versions of the same package coexisting
- Isolated namespaces for feature branches
- Automatic propagation of changes to all consumers

## Core Concepts

### Store

The store is a centralized repository for locally published packages.

**Default location**: `~/.devlink/`

**Custom location**: Use `--repo <path>` flag or `DEVLINK_REPO` environment variable.

**Structure**:
```
~/.devlink/
├── .lock                    # Write serialization lock
├── registry.json            # Package metadata index
├── installations.json       # Consumer project tracking
└── namespaces/
    ├── global/              # Default namespace (reserved, cannot be deleted)
    │   ├── @scope/          # Scoped packages
    │   │   └── package/
    │   │       └── 1.0.0/   # Version directory
    │   │           ├── package.json
    │   │           ├── devlink.sig   # Content signature (MD5)
    │   │           └── dist/         # Package files
    │   └── simple-pkg/      # Non-scoped packages
    │       └── 1.0.0/
    └── feature-branch/      # Custom namespaces
        └── @scope/
            └── package/
                └── 1.0.0/   # Same version, different content
```

### Namespaces

Namespaces are isolated containers for packages. Key points:

- **`global`** is the default namespace and cannot be deleted
- Same package@version can exist in multiple namespaces with different content
- Namespaces are created automatically when publishing to them
- Useful for feature branches, team isolation, or version testing

**Precedence**: When resolving packages, namespaces are searched in order:
```javascript
namespaces: ["feature-v2", "global"]
// 1. Search feature-v2 first
// 2. If not found, search global
// 3. If not found anywhere, error
```

### Registry (registry.json)

Index of all published packages:
```json
{
  "version": "1.0.0",
  "namespaces": {
    "global": {
      "created": "2026-02-12T10:00:00Z",
      "packages": {
        "@scope/package": {
          "versions": {
            "1.0.0": {
              "signature": "6761ca1fefdde1b6e9ea372e7d6931e4",
              "published": "2026-02-12T10:00:00Z",
              "files": 15
            }
          }
        }
      }
    }
  }
}
```

### Installations (installations.json)

Tracks which projects have installed packages (used by `push` command):
```json
{
  "version": "1.0.0",
  "projects": {
    "/home/user/my-project": {
      "registered": "2026-02-12T10:00:00Z",
      "packages": {
        "@scope/package": {
          "version": "1.0.0",
          "namespace": "global",
          "signature": "6761ca1f...",
          "installedAt": "2026-02-12T10:05:00Z"
        }
      }
    }
  }
}
```

### File Locking

Write operations acquire an exclusive lock to prevent corruption:

| Operation | Lock Required | Reason |
|-----------|---------------|--------|
| `publish` | ✓ | Modifies registry, writes files |
| `push` | ✓ | Modifies registry, installations |
| `install` | ✓ | Modifies installations |
| `remove` | ✓ | Modifies registry, deletes files |
| `verify --fix` | ✓ | Modifies registry |
| `prune` | ✓ | Modifies registry, deletes files |
| `consumers --prune` | ✓ | Modifies installations |
| `list` | ✗ | Read-only |
| `resolve` | ✗ | Read-only |
| `verify` | ✗ | Read-only |
| `consumers` | ✗ | Read-only |

Lock parameters: 30s timeout, 100ms retry interval, stale lock detection (removes locks from dead processes).

---

## CLI Reference

### Global Options

All commands support:

| Option | Description |
|--------|-------------|
| `--repo <path>` | Use custom store path instead of `~/.devlink` |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

Environment: `DEVLINK_REPO` can be used instead of `--repo`.

---

## Commands

### devlink publish

Publishes the package in the current directory to the store.

**Usage**:
```bash
devlink publish [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-n, --namespace <name>` | Target namespace (default: `global`) |

**Requirements**: `package.json` must have `name`, `version`, and `files` fields.

**What it does**:
1. Reads `package.json` from current directory
2. Validates name and version exist
3. Copies files specified in `files` field to store
4. Generates content signature (MD5 hash)
5. Updates registry.json

**Examples**:
```bash
# Publish to global namespace
cd /path/to/my-package
devlink publish

# Publish to custom namespace
devlink publish -n feature-v2

# Publish to custom repo
devlink publish --repo /tmp/my-repo
```

**Output**:
```
📦 @scope/my-package@1.0.0 published to global
   Signature: 6761ca1fefdde1b6e9ea372e7d6931e4
   Files: 15
   Path: ~/.devlink/namespaces/global/@scope/my-package/1.0.0
```

---

### devlink push

Publishes the package AND automatically updates all consumer projects.

**Usage**:
```bash
devlink push [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-n, --namespace <name>` | Target namespace (default: `global`) |

**What it does**:
1. Publishes package (same as `devlink publish`)
2. Finds all projects in installations.json that use this package
3. Re-links the package in each consumer's node_modules
4. Updates signatures in installations.json
5. Updates devlink.lock in each consumer project

**Examples**:
```bash
# Push to global, update all consumers
devlink push

# Push to feature namespace
devlink push -n feature-v2
```

**Output**:
```
📦 @scope/core@1.0.0 published to global
   Signature: abc123new

🔄 Pushing to 2 project(s):
   ✓ /home/user/project-a
   ✓ /home/user/project-b
```

**Use case**: During active development, use `push` instead of `publish` to automatically propagate changes.

---

### devlink install

Installs packages from the store into a project based on configuration.

**Usage**:
```bash
devlink install [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-n, --namespaces <list>` | Override namespace precedence (comma-separated) |
| `-c, --config <path>` | Path to config file |
| `--dev` | Force dev mode |
| `--prod` | Force prod mode |
| `--npm` | Run `npm install` before DevLink installs packages |
| `--run-scripts` | Allow npm scripts to run (by default npm runs with `--ignore-scripts`) |

**Configuration file** (`devlink.config.mjs`):
```javascript
export default {
  // Packages to manage with versions per mode
  packages: {
    "@scope/core": { dev: "1.0.0", prod: "1.0.0" },
    "@scope/utils": { dev: "2.0.0", prod: "1.5.0" },
  },

  // Development mode configuration
  dev: (ctx) => ({
    manager: "store",                    // Use DevLink store
    namespaces: ["feature-v2", "global"], // Search order
    peerOptional: ["@scope/*"],          // Transform to optional peers
  }),

  // Production mode configuration
  prod: (ctx) => ({
    manager: "npm",                      // Use npm registry
    args: ["--no-save"],                 // npm arguments
  }),

  // Mode detection logic
  detectMode: (ctx) => {
    // ctx.env - environment variables
    // ctx.args - command line arguments
    // ctx.cwd - current working directory
    if (ctx.env.NODE_ENV === "development") return "dev";
    if (ctx.args.includes("--dev")) return "dev";
    return "prod";
  },
};
```

#### peerOptional

When packages in the store have internal dependencies (e.g., `@scope/core` depends on `@scope/utils`), npm will try to resolve them from the registry during `npm install`. If these packages aren't published to npm yet, the install fails.

The `peerOptional` option solves this by transforming matching dependencies when copying packages to `node_modules`:

```javascript
dev: (ctx) => ({
  manager: "store",
  peerOptional: ["@scope/*"],  // Glob patterns
})
```

**Transformation applied to copied packages:**

| Original | Transformed |
|----------|-------------|
| `dependencies: { "@scope/utils": "1.0.0" }` | `peerDependencies: { "@scope/utils": "1.0.0" }` |
| (none) | `peerDependenciesMeta: { "@scope/utils": { "optional": true } }` |

**Supported patterns:**
- `@scope/*` - All packages in scope
- `@scope/pkg` - Exact package name
- `*` - All packages

**Important:** Only the copy in `node_modules` is modified. The original package in the store remains unchanged.

**What it does**:
1. Reads devlink.config.mjs
2. Determines mode (dev/prod)
3. For each package, resolves using namespace precedence
4. Creates symlinks in node_modules
5. Registers project in installations.json
6. Creates/updates devlink.lock

**Examples**:
```bash
# Install using config file
devlink install

# Force dev mode
devlink install --dev

# Override namespaces
devlink install -n feature-v2,global

# Run npm install first, then DevLink
devlink install --dev --npm

# Allow npm scripts to run
devlink install --dev --npm --run-scripts
```

**Lock file** (`devlink.lock`):
```json
{
  "packages": {
    "@scope/core": {
      "version": "1.0.0",
      "namespace": "global",
      "signature": "6761ca1f...",
      "resolved": "~/.devlink/namespaces/global/@scope/core/1.0.0"
    }
  }
}
```

---

### devlink list

Lists packages in the store.

**Usage**:
```bash
devlink list [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-n, --namespaces <list>` | Filter by namespaces (comma-separated) |
| `-p, --packages [list]` | Group by package, optionally filter |
| `--flat` | Flat output format (default: tree) |

**Examples**:
```bash
# List all packages (tree format)
devlink list

# Flat format (good for scripting)
devlink list --flat

# Filter by namespace
devlink list -n global

# Filter by scope
devlink list -p @myorg

# Group by package instead of namespace
devlink list -p
```

**Tree output**:
```
📦 Dev-Link Store

global/
├── @scope/
│   ├── core/
│   │   ├── 1.0.0  (6761ca1f)
│   │   └── 2.0.0  (a1b2c3d4)
│   └── utils/
│       └── 1.0.0  (b2c3d4e5)
└── simple-pkg/
    └── 1.0.0  (c3d4e5f6)

feature-v2/
└── @scope/
    └── core/
        └── 1.0.0  (different1)
```

**Flat output**:
```
global  @scope/core@1.0.0      6761ca1f
global  @scope/core@2.0.0      a1b2c3d4
global  @scope/utils@1.0.0     b2c3d4e5
feature-v2  @scope/core@1.0.0  different1
```

---

### devlink resolve

Debug package resolution - shows where packages would be found.

**Usage**:
```bash
devlink resolve <pkg@version> [...] [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-n, --namespaces <list>` | Namespace precedence (comma-separated) |
| `--flat` | Flat output format |

**Examples**:
```bash
# Resolve single package
devlink resolve @scope/core@1.0.0

# Resolve with namespace precedence
devlink resolve @scope/core@1.0.0 -n feature-v2,global

# Resolve multiple packages
devlink resolve @scope/core@1.0.0 @scope/utils@2.0.0 -n feature-v2,global
```

**Output**:
```
Resolving with precedence: feature-v2 → global

@scope/core@1.0.0
  ✓ Found in: feature-v2
  Path: ~/.devlink/namespaces/feature-v2/@scope/core/1.0.0
  Signature: different123456

@scope/utils@2.0.0
  ⊘ Not in: feature-v2
  ✓ Found in: global
  Path: ~/.devlink/namespaces/global/@scope/utils/2.0.0
  Signature: a1b2c3d4

Summary: 2/2 resolved
```

**Not found**:
```
@scope/missing@1.0.0
  ⊘ Not in: feature-v2
  ⊘ Not in: global
  ✗ Not found in any namespace
```

---

### devlink consumers

Lists projects that have installed packages from the store.

**Usage**:
```bash
devlink consumers [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-p, --package <name>` | Filter by package name |
| `-n, --namespace <name>` | Filter by namespace |
| `--prune` | Remove projects that no longer exist |
| `--flat` | Flat output format |

**Examples**:
```bash
# List all consumers
devlink consumers

# Filter by package
devlink consumers -p @scope/core

# Filter by namespace
devlink consumers -n feature-v2

# Remove dead projects
devlink consumers --prune
```

**Output**:
```
📦 Consumer Projects

/home/user/project-a
├── @scope/core@1.0.0 (global)
├── @scope/utils@1.0.0 (global)
└── Registered: 2026-02-12T10:00:00Z

/home/user/project-b
├── @scope/core@1.0.0 (feature-v2)
└── Registered: 2026-02-12T11:00:00Z

Total: 2 projects, 3 installations
```

---

### devlink remove

Removes packages, versions, or namespaces from the store.

**Usage**:
```bash
devlink remove <target> [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-n, --namespace <name>` | Target namespace (required for packages) |

**Target types**:

| Target | Example | Description |
|--------|---------|-------------|
| Version | `@scope/pkg@1.0.0` | Remove specific version |
| Package | `@scope/pkg` | Remove all versions |
| Namespace | `feature-v2` | Remove entire namespace |

**Examples**:
```bash
# Remove specific version
devlink remove @scope/core@1.0.0 -n global

# Remove all versions of a package
devlink remove @scope/core -n global

# Remove entire namespace
devlink remove feature-v2
```

**Restrictions**:
- Cannot remove `global` namespace (reserved)
- Must specify `-n` when removing packages

**Output**:
```
✓ Removed @scope/core@1.0.0 from namespace 'global'
```

---

### devlink verify

Verifies store integrity - checks for inconsistencies between registry and disk.

**Usage**:
```bash
devlink verify [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `--fix` | Automatically fix issues found |

**Checks performed**:
- **Orphans in registry**: Entries without corresponding files on disk
- **Orphans on disk**: Files without registry entries
- **Signature mismatches**: Content doesn't match recorded signature

**Examples**:
```bash
# Check only
devlink verify

# Check and fix
devlink verify --fix
```

**Output (issues found)**:
```
🔍 Verifying store integrity...

global/
  ✓ @scope/core@1.0.0
  ✗ @scope/data@1.0.0 - In registry, not on disk
  ✓ @scope/utils@1.0.0
  ⚠ @scope/orphan@1.0.0 - On disk, not in registry

─────────────────────────────────
Summary:
  ✓ Valid:                2
  ✗ Orphans in registry:  1
  ⚠ Orphans on disk:      1

Run 'devlink verify --fix' to repair
```

---

### devlink prune

Removes orphaned packages from disk (files not in registry).

**Usage**:
```bash
devlink prune [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-n, --namespace <name>` | Only prune in specific namespace |
| `--dry-run` | Show what would be removed without removing |

**Examples**:
```bash
# Remove all orphans
devlink prune

# Preview only
devlink prune --dry-run

# Prune specific namespace
devlink prune -n feature-v2
```

**Output**:
```
🧹 Pruning orphaned packages...

Removed:
  ✓ global/@scope/orphan@1.0.0
  ✓ feature-v2/@scope/old-pkg@2.0.0

Pruned 2 package(s), freed 15.2 MB
```

---

### devlink docs

Display embedded documentation directly from the CLI.

**Usage**:
```bash
devlink docs [document]
```

**Arguments**:
| Argument | Description |
|----------|-------------|
| `[document]` | Document or directory path (case insensitive, .md optional) |

**Behavior**:
- No argument: shows documentation tree
- Directory path: lists documents in that directory
- File path: displays document content

**Examples**:
```bash
# Show documentation tree
devlink docs

# Show AI agent guide (comprehensive)
devlink docs agents

# List store documents
devlink docs store

# Show specific document
devlink docs store/namespaces
devlink docs STORE/NAMESPACES    # Case insensitive
devlink docs publishing/push
```

**Output (tree)**:
```
📚 DevLink Documentation

├── agents
├── inspection/
│   ├── consumers
│   ├── list
│   └── resolve
├── installation/
│   ├── configuration
│   └── install
├── maintenance/
│   ├── prune
│   ├── remove
│   └── verify
├── publishing/
│   ├── publish
│   └── push
└── store/
    ├── locking
    ├── namespaces
    └── structure
```

**Special documents**:
- `agents` - Complete self-contained guide for AI agents (this document)

---

## Common Workflows

### Initial Setup: Publish a Library

```bash
cd /path/to/my-library
# Ensure package.json has name, version, files fields
devlink publish
```

### Setup Consumer Project

1. Create `devlink.config.mjs`:
```javascript
export default {
  packages: {
    "@myorg/core": { dev: "1.0.0" },
    "@myorg/utils": { dev: "1.0.0" },
  },
  dev: () => ({
    manager: "store",
    namespaces: ["global"],
    // If packages have internal dependencies, mark them as optional
    peerOptional: ["@myorg/*"],
  }),
};
```

2. Install:
```bash
devlink install --dev
```

### Using DevLink as Default Install Command

Replace `npm install` with DevLink during development using npm lifecycle hooks:

**package.json:**
```json
{
  "scripts": {
    "predev:install": "echo '🔧 Preparing development environment...'",
    "dev:install": "devlink install --dev --npm",
    "postdev:install": "echo '✅ Development environment ready'"
  }
}
```

**Usage:**
```bash
npm run dev:install
```

**Execution flow:**
1. `predev:install` - Runs before (preparation tasks)
2. `dev:install` - Runs npm install + DevLink install
3. `postdev:install` - Runs after (verification, notifications)

This pattern ensures DevLink packages are always installed after npm dependencies, preventing npm from pruning them.

### Monorepo with Internal Dependencies

When your SDK packages depend on each other (e.g., `@myorg/http` depends on `@myorg/core`), use `peerOptional` to prevent npm from trying to resolve them from the registry:

```javascript
// devlink.config.mjs
export default {
  packages: {
    "@myorg/core": { dev: "1.0.0" },
    "@myorg/http": { dev: "1.0.0" },  // depends on @myorg/core
    "@myorg/sst": { dev: "1.0.0" },   // depends on @myorg/http
  },
  dev: () => ({
    manager: "store",
    peerOptional: ["@myorg/*"],  // All internal deps become optional peers
  }),
  prod: () => ({
    manager: "npm",  // In prod, npm resolves from registry normally
  }),
};
```

With `peerOptional`, DevLink transforms the copied packages so npm doesn't fail looking for unpublished internal dependencies.

### Development Cycle

```bash
# Make changes to library
cd /path/to/my-library
vim src/index.ts
npm run build

# Push to all consumers
devlink push
```

### Feature Branch Development

```bash
# Publish to feature namespace
cd /path/to/my-library
devlink publish -n feature-auth-v2

# Consumer uses feature namespace first
# devlink.config.mjs: namespaces: ["feature-auth-v2", "global"]
cd /path/to/consumer
devlink install --dev

# After feature is merged, clean up
devlink remove feature-auth-v2
```

### Debug Resolution Issues

```bash
# Check where package would be resolved from
devlink resolve @myorg/core@1.0.0 -n feature-v2,global

# List all packages to see what's available
devlink list

# Check who's using a package
devlink consumers -p @myorg/core
```

### Store Maintenance

```bash
# Verify store health
devlink verify

# Fix any issues
devlink verify --fix

# Clean up orphaned files
devlink prune --dry-run  # Preview first
devlink prune            # Actually clean

# Remove dead consumer projects
devlink consumers --prune
```

### Multiple Repos

```bash
# Use different repos for different contexts
devlink --repo ~/repos/team-a publish
devlink --repo ~/repos/team-b publish

# Or via environment variable
export DEVLINK_REPO=~/repos/team-a
devlink list
```

---

## Error Handling

### Package Not Found
```
Error: @scope/core@1.0.0 not found in namespaces: feature-v2, global
```
**Solution**: Publish the package first, or check namespace configuration.

### Missing package.json
```
Error: package.json not found
```
**Solution**: Run from a directory with a valid package.json.

### Missing name or version
```
Error: package.json must have name and version fields
```
**Solution**: Add required fields to package.json.

### Cannot remove global namespace
```
Error: Cannot delete reserved namespace 'global'
```
**Solution**: The global namespace cannot be deleted. Remove individual packages instead.

### Lock timeout
```
Error: Lock timeout after 30000ms
```
**Solution**: Another process is holding the lock. Wait or check for stale locks.

---

## Source Code Structure

```
src/
├── cli-new.ts              # CLI entry point, argument parsing
├── constants.ts            # Paths, defaults, repo configuration
├── types.ts                # TypeScript type definitions
├── core/
│   ├── lock.ts             # File locking implementation
│   ├── registry.ts         # Registry read/write operations
│   ├── installations.ts    # Consumer tracking operations
│   ├── store.ts            # Filesystem operations (copy, delete, etc.)
│   └── resolver.ts         # Package resolution algorithm
├── commands/
│   ├── publish.ts          # Publish command
│   ├── push.ts             # Push command
│   ├── install.ts          # Install command
│   ├── list.ts             # List command
│   ├── resolve.ts          # Resolve command
│   ├── consumers.ts        # Consumers command
│   ├── remove.ts           # Remove command
│   ├── verify.ts           # Verify command
│   └── prune.ts            # Prune command
└── formatters/
    ├── tree.ts             # Tree output format
    └── flat.ts             # Flat output format
```

---

## Testing

```bash
npm test                    # Run all tests
npm run test:coverage       # With coverage report
```

Test fixtures are in `fixtures/packages/` for integration testing.

---

## Further Reading

For detailed documentation on specific topics, see the `docs/` directory:
- `docs/store/` - Store structure, namespaces, locking
- `docs/publishing/` - Publish and push commands
- `docs/installation/` - Install command and configuration
- `docs/inspection/` - List, resolve, consumers commands
- `docs/maintenance/` - Remove, verify, prune commands
