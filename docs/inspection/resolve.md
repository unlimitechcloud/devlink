# Resolve Command

Debug package resolution by showing where packages would be found.

## Usage

```bash
devlink resolve <pkg@version> [...] [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `<pkg@version>` | Package spec(s) to resolve |

## Options

| Option | Description |
|--------|-------------|
| `-n, --namespaces <list>` | Namespace precedence (comma-separated) |
| `--flat` | Use flat output format |
| `--path` | Output only store paths, one per line (machine-readable) |
| `--repo <path>` | Use custom repo path |

## Description

The `resolve` command shows:

- Which namespace a package would be resolved from
- The full path to the package
- The package signature
- Which namespaces were searched

This is useful for debugging resolution issues before running `install`.

## Examples

### Resolve Single Package

```bash
devlink resolve @scope/core@1.0.0
```

Output:
```
Resolving with precedence: global

@scope/core@1.0.0
  ✓ Found in: global
  Path: ~/.devlink/namespaces/global/@scope/core/1.0.0
  Signature: 6761ca1fefdde1b6e9ea372e7d6931e4

Summary: 1/1 resolved
```

### Resolve with Namespace Precedence

```bash
devlink resolve @scope/core@1.0.0 -n feature-v2,global
```

Output:
```
Resolving with precedence: feature-v2 → global

@scope/core@1.0.0
  ✓ Found in: feature-v2
  Path: ~/.devlink/namespaces/feature-v2/@scope/core/1.0.0
  Signature: different123456

Summary: 1/1 resolved
```

### Resolve Multiple Packages

```bash
devlink resolve @scope/core@1.0.0 @scope/utils@2.0.0 -n feature-v2,global
```

Output:
```
Resolving with precedence: feature-v2 → global

@scope/core@1.0.0
  ✓ Found in: feature-v2
  Path: ~/.devlink/namespaces/feature-v2/@scope/core/1.0.0
  Signature: abc123

@scope/utils@2.0.0
  ⊘ Not in: feature-v2
  ✓ Found in: global
  Path: ~/.devlink/namespaces/global/@scope/utils/2.0.0
  Signature: def456

Summary: 2/2 resolved
```

### Package Not Found

```bash
devlink resolve @scope/missing@1.0.0 -n feature-v2,global
```

Output:
```
Resolving with precedence: feature-v2 → global

@scope/missing@1.0.0
  ⊘ Not in: feature-v2
  ⊘ Not in: global
  ✗ Not found in any namespace

Summary: 0/1 resolved
```

### Flat Output

```bash
devlink resolve @scope/core@1.0.0 @scope/utils@2.0.0 --flat
```

Output:
```
✓ @scope/core@1.0.0        global     6761ca1f
✓ @scope/utils@2.0.0       global     a1b2c3d4
```

### Path Output (Machine-Readable)

```bash
devlink resolve @scope/core@1.0.0 --path
```

Output:
```
~/.devlink/namespaces/global/@scope/core/1.0.0
```

Only resolved paths are printed, one per line. Unresolved packages produce no output. Useful for scripting.

## Use Cases

### Debug Installation Issues

Before running `install`, verify packages can be resolved:

```bash
# Check all packages from your config
devlink resolve @scope/core@1.0.0 @scope/utils@1.0.0 -n feature-v2,global
```

### Verify Namespace Precedence

Check which namespace would be used:

```bash
# Same package in multiple namespaces
devlink resolve @scope/core@1.0.0 -n feature-v2,global
# Shows: Found in feature-v2

devlink resolve @scope/core@1.0.0 -n global,feature-v2
# Shows: Found in global (different precedence)
```

### Check Package Availability

Verify a package was published correctly:

```bash
devlink resolve @scope/new-pkg@1.0.0
```

## Resolution Algorithm

1. Parse package spec (`name@version`)
2. For each namespace in order:
   - Check if `namespace/name/version` exists in registry
   - If found, return path and signature
3. If not found in any namespace, report as not found

## See Also

- [List Command](list.md) - See all packages in the store
- [Namespaces](../store/namespaces.md) - Understanding namespace precedence
- [Install Command](../installation/install.md) - How resolution is used during install
