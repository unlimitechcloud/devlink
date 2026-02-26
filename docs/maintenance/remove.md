# Remove Command

Removes packages, versions, or namespaces from the store.

## Usage

```bash
dev-link remove <target> [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `<target>` | What to remove (see Target Types) |

## Options

| Option | Description |
|--------|-------------|
| `-n, --namespace <name>` | Target namespace (required for packages) |
| `--repo <path>` | Use custom repo path |

## Target Types

### Specific Version

Remove a single version of a package:

```bash
dev-link remove @scope/core@1.0.0 -n global
```

### Entire Package

Remove all versions of a package:

```bash
dev-link remove @scope/core -n global
```

### Namespace

Remove an entire namespace and all packages within:

```bash
dev-link remove feature-v2
```

## Examples

### Remove Specific Version

```bash
dev-link remove @scope/core@1.0.0 -n global
```

Output:
```
✓ Removed @scope/core@1.0.0 from namespace 'global'
```

### Remove All Versions

```bash
dev-link remove @scope/core -n global
```

Output:
```
✓ Removed package '@scope/core' from namespace 'global'
```

### Remove Namespace

```bash
dev-link remove feature-v2
```

Output:
```
✓ Removed namespace 'feature-v2'
```

## Restrictions

### Cannot Remove Global Namespace

The `global` namespace is reserved and cannot be deleted:

```bash
dev-link remove global
```

Output:
```
Error: Cannot delete reserved namespace 'global'
```

### Namespace Required for Packages

When removing packages, you must specify the namespace:

```bash
# Error: namespace required
dev-link remove @scope/core

# Correct
dev-link remove @scope/core -n global
```

## What Gets Removed

### Version Removal

- Package files from disk
- Version entry from registry
- If last version, package entry is also removed

### Package Removal

- All version directories
- Package directory
- Package entry from registry

### Namespace Removal

- All packages in the namespace
- Namespace directory
- Namespace entry from registry

## Consumer Impact

Removing packages does NOT automatically update consumers. Projects that have installed the removed package will:

- Keep their existing symlinks (may become broken)
- Need to reinstall with a different version/namespace

To check affected consumers before removing:

```bash
dev-link consumers -p @scope/core -n global
```

## Use Cases

### Clean Up Old Versions

```bash
# Keep only latest version
dev-link remove @scope/core@1.0.0 -n global
dev-link remove @scope/core@1.1.0 -n global
# 2.0.0 remains
```

### Remove Feature Branch Namespace

After merging a feature branch:

```bash
dev-link remove feature-auth-v2
```

### Remove Accidentally Published Package

```bash
dev-link remove @scope/wrong-pkg -n global
```

## See Also

- [Prune Command](prune.md) - Remove orphaned packages
- [Verify Command](verify.md) - Check store integrity
- [Namespaces](../store/namespaces.md) - Understanding namespaces
