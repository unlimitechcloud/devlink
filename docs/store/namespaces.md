# Namespaces

Namespaces provide isolated contexts for packages, allowing multiple versions or variants of the same package to coexist.

## Concept

A namespace is a logical container for packages. Each namespace is independent, meaning:

- The same package@version can exist in multiple namespaces with different content
- Projects can choose which namespaces to search when resolving packages
- Feature branches can have their own namespace without affecting stable packages

## The Global Namespace

The `global` namespace is special:

- **Reserved**: Cannot be deleted
- **Default**: Used when no namespace is specified
- **Fallback**: Typically the last namespace in precedence order

```bash
# These are equivalent
devlink publish
devlink publish -n global
```

## Creating Namespaces

Namespaces are created automatically when you publish to them:

```bash
# Creates 'feature-v2' namespace if it doesn't exist
devlink publish -n feature-v2
```

## Use Cases

### Feature Branch Development

Isolate experimental changes without affecting stable packages:

```bash
# Developer working on v2 API
cd my-sdk
devlink publish -n sdk-v2

# Consumer project uses sdk-v2 first, falls back to global
# devlink.config.mjs:
# namespaces: ["sdk-v2", "global"]
```

### Team Isolation

Different teams can have their own namespaces:

```bash
devlink publish -n team-frontend
devlink publish -n team-backend
```

### Version Testing

Test new versions before promoting to global:

```bash
# Publish beta to testing namespace
devlink publish -n testing

# After validation, publish to global
devlink publish -n global
```

## Namespace Precedence

When resolving packages, namespaces are searched in order:

```javascript
// devlink.config.mjs
export default {
  dev: () => ({
    manager: "store",
    namespaces: ["feature-v2", "global"],
  }),
};
```

Resolution order:
1. Search in `feature-v2`
2. If not found, search in `global`
3. If not found anywhere, error

### Example

```
Store contents:
  global/@scope/core@1.0.0
  global/@scope/utils@1.0.0
  feature-v2/@scope/core@1.0.0  (different code)

With namespaces: ["feature-v2", "global"]

Resolving @scope/core@1.0.0:
  → Found in feature-v2 ✓

Resolving @scope/utils@1.0.0:
  → Not in feature-v2
  → Found in global ✓
```

## Listing Namespaces

```bash
# List all packages grouped by namespace
devlink list

# List specific namespaces
devlink list -n global,feature-v2
```

## Removing Namespaces

```bash
# Remove entire namespace (and all packages within)
devlink remove feature-v2

# Note: Cannot remove 'global' namespace
devlink remove global  # Error!
```

## Best Practices

1. **Use descriptive names**: `feature-auth-v2`, `team-mobile`, `release-candidate`
2. **Clean up old namespaces**: Remove namespaces when feature branches are merged
3. **Keep global stable**: Only publish tested packages to global
4. **Document namespace usage**: Let team members know which namespaces to use

## See Also

- [Store Structure](structure.md) - How namespaces are stored on disk
- [Resolve Command](../inspection/resolve.md) - Debug namespace resolution
- [Configuration](../installation/configuration.md) - Configure namespace precedence
