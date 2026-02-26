# List Command

Lists packages in the DevLink store.

## Usage

```bash
dev-link list [options]
```

## Options

| Option | Description |
|--------|-------------|
| `-n, --namespaces <list>` | Filter by namespaces (comma-separated) |
| `-p, --packages [list]` | Group by package, optionally filter |
| `--flat` | Use flat output format (default: tree) |
| `--repo <path>` | Use custom repo path |

## Output Formats

### Tree Format (Default)

Hierarchical view with visual tree structure:

```bash
dev-link list
```

```
📦 DevLink Store

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

### Flat Format

One line per package, suitable for scripting:

```bash
dev-link list --flat
```

```
global  @scope/core@1.0.0      6761ca1f
global  @scope/core@2.0.0      a1b2c3d4
global  @scope/utils@1.0.0     b2c3d4e5
global  simple-pkg@1.0.0       c3d4e5f6
feature-v2  @scope/core@1.0.0  different1
```

## Grouping

### By Namespace (Default)

Packages grouped under their namespace:

```bash
devlink list
```

### By Package

Packages grouped by name, showing which namespaces contain them:

```bash
dev-link list -p
```

```
📦 DevLink Store (by package)

@scope/
├── core/
│   ├── global/
│   │   ├── 1.0.0  (6761ca1f)
│   │   └── 2.0.0  (a1b2c3d4)
│   └── feature-v2/
│       └── 1.0.0  (different1)
└── utils/
    └── global/
        └── 1.0.0  (b2c3d4e5)
```

## Filtering

### Filter by Namespace

```bash
# Single namespace
dev-link list -n global

# Multiple namespaces
dev-link list -n global,feature-v2
```

### Filter by Package

```bash
# Specific packages
dev-link list -p @scope/core,@scope/utils

# By scope (all packages in scope)
dev-link list -p @scope
```

### Combined Filters

```bash
# Packages in specific namespace
dev-link list -n global -p @scope/core
```

## Examples

### List Everything

```bash
dev-link list
```

### List Only Global Namespace

```bash
dev-link list -n global
```

### List Packages by a Scope

```bash
dev-link list -p @myorg
```

### Flat Output for Scripting

```bash
# Count packages
dev-link list --flat | wc -l

# Find specific package
dev-link list --flat | grep "@scope/core"

# List all versions of a package
dev-link list --flat | grep "@scope/core@"
```

### Compare Namespaces

```bash
# See what's in feature branch vs global
dev-link list -n feature-v2
dev-link list -n global
```

## Empty Store

If the store is empty or has no packages:

```
📦 DevLink Store

└── global/
```

## See Also

- [Resolve Command](resolve.md) - Debug package resolution
- [Store Structure](../store/structure.md) - Understanding the store layout
- [Namespaces](../store/namespaces.md) - Understanding namespaces
