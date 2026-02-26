# Configuration

DevLink uses a configuration file to define which packages to manage and how to resolve them.

## Config File

Create `devlink.config.mjs` in your project root:

```javascript
export default {
  packages: { /* ... */ },
  dev: () => ({ /* ... */ }),
  remote: () => ({ /* ... */ }),
  detectMode: (ctx) => { /* ... */ },
};
```

### Supported File Names

In order of priority:
1. `devlink.config.mjs`
2. `devlink.config.js`
3. `devlink.config.cjs`

## Configuration Options

### packages

Defines which packages to manage and their versions per mode. Each key is a package name, and the value is an object mapping mode names to version strings.

```javascript
packages: {
  "@scope/core": { dev: "1.0.0", remote: "1.0.0" },
  "@scope/utils": { dev: "2.0.0", remote: "1.5.0" },
  "@scope/dev-tools": { dev: "1.0.0" },  // only available in dev mode
}
```

If a package doesn't have a version for the current mode, it will be removed from `package.json` during `--npm` installs, or skipped during direct copy installs.

### Mode Factories

Modes are defined as top-level properties in the config. Each mode is a factory function that returns a `ModeConfig` object. You can define any number of modes with any name.

```javascript
// Development mode — uses local DevLink store
dev: (ctx) => ({
  manager: "store",
  namespaces: ["feature", "global"],
}),

// Remote mode — uses npm registry (e.g. GitHub Packages)
remote: (ctx) => ({
  manager: "npm",
  args: ["--no-save"],
}),
```

Reserved property names (cannot be used as mode names): `packages`, `detectMode`.

### detectMode

Optional function to automatically determine which mode to use when no `--mode` flag is provided.

```javascript
detectMode: (ctx) => {
  // ctx.env - Environment variables
  // ctx.args - Command line arguments (process.argv)
  // ctx.cwd - Current working directory
  // ctx.packages - The packages config object
  
  if (ctx.env.NODE_ENV === "development") return "dev";
  if (ctx.env.SST_LOCAL === "true") return "dev";
  return "remote";
}
```

If `detectMode` is not defined and no `--mode` flag is provided, defaults to `"dev"`.

## Context Object

The `ctx` object passed to factory functions and `detectMode`:

```typescript
interface FactoryContext {
  env: Record<string, string>;                    // process.env
  args: string[];                                  // process.argv
  cwd: string;                                     // Current working directory
  packages: Record<string, PackageVersions>;       // The packages config
}
```

## Manager Types

### store

Uses the DevLink store to resolve packages:

```javascript
{
  manager: "store",
  namespaces: ["feature-v2", "global"],
}
```

### npm

Packages are resolved by npm from the configured registry. When used with `--npm`, DevLink injects packages as exact versions into a temporary `package.json`.

```javascript
{
  manager: "npm",
  args: ["--no-save", "--legacy-peer-deps"],
}
```

## Complete Example

```javascript
export default {
  // Packages to manage — versions per mode
  packages: {
    "@myorg/core": { dev: "1.0.0", remote: "1.0.0" },
    "@myorg/utils": { dev: "1.0.0", remote: "1.0.0" },
    "@myorg/http": { dev: "1.0.0", remote: "1.0.0" },
    "@myorg/dev-tools": { dev: "1.0.0" },  // dev only
  },

  // Development mode: use local store
  dev: () => ({
    manager: "store",
    namespaces: ["global"],
  }),

  // Remote mode: use npm registry (GitHub Packages, etc.)
  remote: () => ({
    manager: "npm",
  }),

  // Mode detection
  detectMode: (ctx) => {
    if (ctx.env.SST_LOCAL === "true") return "dev";
    if (ctx.env.NODE_ENV === "development") return "dev";
    return "remote";
  },
};
```

## Mode Selection

The mode is determined by (in priority order):

1. `--mode <name>` CLI flag
2. `--dev` shorthand (equivalent to `--mode dev`)
3. `--prod` shorthand (equivalent to `--mode prod`)
4. `detectMode()` function in config
5. Default: `"dev"`

```bash
# Explicit mode
devlink install --mode remote --npm

# Shorthand
devlink install --dev --npm

# Auto-detect via detectMode()
devlink install --npm
```

## Namespace Override

The `-n` flag overrides configured namespaces:

```bash
# Uses namespaces from config
devlink install

# Overrides to use feature-v2 first
devlink install -n feature-v2,global
```

## Tips

### Dynamic Namespaces

Use environment variables for flexible namespace configuration:

```javascript
dev: (ctx) => ({
  manager: "store",
  namespaces: ctx.env.FEATURE_BRANCH 
    ? [ctx.env.FEATURE_BRANCH, "global"]
    : ["global"],
})
```

### Version Pinning

Pin exact versions for reproducibility:

```javascript
packages: {
  "@scope/core": { dev: "1.2.3", remote: "1.2.3" },
}
```

### Different Versions Per Mode

Use different versions for development and remote:

```javascript
packages: {
  "@scope/core": { 
    dev: "2.0.0-beta.1",  // Latest beta for development
    remote: "1.5.0",       // Stable for remote/CI
  },
}
```

### Mode-Specific Package Sets

Packages without a version for a mode are removed during `--npm` installs:

```javascript
packages: {
  "@scope/core": { dev: "1.0.0", remote: "1.0.0" },     // both modes
  "@scope/dev-tools": { dev: "1.0.0" },                   // dev only
  "@scope/ci-tools": { remote: "1.0.0" },                 // remote only
}
```

## See Also

- [Install Command](install.md) - Using the configuration
- [Namespaces](../store/namespaces.md) - Understanding namespace precedence
