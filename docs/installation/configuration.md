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

Defines which packages to manage and their versions. Each key is a package name, and the value is a spec object with a `version` field.

The `version` field supports two formats:

**Per-mode object** — different versions per mode:
```javascript
packages: {
  "@scope/core": { version: { dev: "1.0.0", remote: "1.0.0" } },
  "@scope/utils": { version: { dev: "2.0.0", remote: "1.5.0" } },
  "@scope/dev-tools": { version: { dev: "1.0.0" } },  // only available in dev mode
}
```

**Universal string** — same version for all modes:
```javascript
packages: {
  "@scope/core": { version: "1.0.0" },       // resolved in every mode
  "@scope/utils": { version: "2.0.0" },      // resolved in every mode
}
```

### synthetic

Marks a package as synthetic. Synthetic packages are staged to `.devlink/` instead of being injected into `package.json`. This is useful for packages that should be available locally (e.g., for `file:` references or tooling) but should not appear as npm dependencies.

```javascript
packages: {
  "@myorg/sst": { version: { dev: "0.4.0" }, synthetic: true },
  "@myorg/core": { version: "1.0.0" },  // normal package
}
```

### link

Specifies a local path for `npm link` resolution. Packages with `link` skip store/npm resolution entirely — they are not staged, not injected into `package.json`, and not copied from the store. Instead, after `npm install` completes, DevLink runs `npm link <path>` for each linked package.

```javascript
packages: {
  "@myorg/sdk": { version: "1.0.0", link: "../sdk" },           // relative path
  "@myorg/tools": { version: "1.0.0", link: "/home/user/tools" }, // absolute path
}
```

Relative paths are resolved against the project root. The `link` attribute works in all install flows (no-mode, store manager, npm manager). The `version` field is still required for config validation but is not used for resolution.

### dev

Marks a package as a dev dependency. When DevLink injects the package into `package.json`, it goes into `devDependencies` instead of `dependencies`. This is a global flag — it applies regardless of the active mode or manager type.

```javascript
packages: {
  "@myorg/core": { version: "1.0.0" },                          // → dependencies
  "@myorg/test-utils": { version: "1.0.0", dev: true },         // → devDependencies
  "@myorg/lint-config": { version: { dev: "1.0.0" }, dev: true }, // → devDependencies (dev mode only)
}
```

The `dev` flag has no effect on synthetic packages (they are never injected into `package.json`).

Synthetic packages follow the same bidirectional fallback as normal packages:
- **Store manager**: Resolved from the store and copied to `.devlink/{name}/`. If not found → `npm pack` to `.devlink/`
- **npm manager**: Downloaded via `npm pack` to `.devlink/{name}/`. If not found in npm → copied from store (mode namespaces) to `.devlink/`
- **No-mode**: Universal synthetic packages use `npm pack` as primary → store (global namespace) copy as fallback

In all cases, synthetic packages never appear in `package.json` — they are always staged to `.devlink/`.

The universal string format is equivalent to `{ "*": "1.0.0" }` internally. It ensures the package is always resolved regardless of the active mode.

You can mix both formats:
```javascript
packages: {
  "@scope/core": { version: "1.0.0" },                              // all modes
  "@scope/dev-tools": { version: { dev: "1.0.0" } },                // dev only
  "@scope/utils": { version: { dev: "2.0.0", remote: "1.5.0" } },  // different per mode
}
```

If a package doesn't have a version for the current mode, it will be removed from `package.json` during install, or skipped if no mode is active.

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

If `detectMode` is not defined and no `--mode` flag is provided, no mode is active — only universal packages are resolved.

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

Packages are resolved by npm from the configured registry. DevLink verifies each package via `npm view` and injects them as exact versions into a temporary `package.json` for npm to resolve. If a package is not found in npm, DevLink falls back to the store (mode namespaces) and stages it via `file:` protocol.

```javascript
{
  manager: "npm",
}
```

## Complete Example

```javascript
export default {
  // Packages to manage
  packages: {
    // Universal version — resolved in all modes
    "@myorg/core": { version: "1.0.0" },
    "@myorg/utils": { version: "1.0.0" },

    // Per-mode versions
    "@myorg/http": { version: { dev: "1.0.0", remote: "1.0.0" } },
    "@myorg/dev-tools": { version: { dev: "1.0.0" } },  // dev only

    // Synthetic — staged to .devlink/, not injected in package.json
    "@myorg/sst": { version: { dev: "0.4.0" }, synthetic: true },

    // Dev dependency — injected into devDependencies
    "@myorg/test-utils": { version: "1.0.0", dev: true },

    // Link — resolved via npm link, skips store/npm resolution
    "@myorg/local-sdk": { version: "1.0.0", link: "../sdk" },
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
2. `detectMode()` function in config
3. If none specified → no mode (universal packages only)

```bash
# Explicit mode
dev-link install --mode remote

# Auto-detect via detectMode()
dev-link install
```

## Namespace Override

The `-n` flag overrides configured namespaces:

```bash
# Uses namespaces from config
dev-link install

# Overrides to use feature-v2 first
dev-link install -n feature-v2,global
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
  "@scope/core": { version: "1.2.3" },                    // universal
  "@scope/utils": { version: { dev: "1.2.3", remote: "1.2.3" } },  // per-mode
}
```

### Different Versions Per Mode

Use different versions for development and remote:

```javascript
packages: {
  "@scope/core": { version: { 
    dev: "2.0.0-beta.1",  // Latest beta for development
    remote: "1.5.0",       // Stable for remote/CI
  }},
}
```

### Universal Versions

Use a string version when the same version applies to all modes:

```javascript
packages: {
  "@scope/core": { version: "1.0.0" },  // always resolved, regardless of mode
}
```

### Mode-Specific Package Sets

Packages without a version for a mode are removed during install:

```javascript
packages: {
  "@scope/core": { version: { dev: "1.0.0", remote: "1.0.0" } },  // both modes
  "@scope/dev-tools": { version: { dev: "1.0.0" } },               // dev only
  "@scope/ci-tools": { version: { remote: "1.0.0" } },             // remote only
}
```

## See Also

- [Install Command](install.md) - Using the configuration
- [Namespaces](../store/namespaces.md) - Understanding namespace precedence
