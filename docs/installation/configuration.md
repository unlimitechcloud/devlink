# Configuration

DevLink uses a configuration file to define which packages to manage and how to resolve them.

## Config File

Create `devlink.config.mjs` in your project root:

```javascript
export default {
  packages: { /* ... */ },
  dev: () => ({ /* ... */ }),
  prod: () => ({ /* ... */ }),
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

Defines which packages to manage and their versions per mode.

```javascript
packages: {
  "@scope/core": { dev: "1.0.0", prod: "1.0.0" },
  "@scope/utils": { dev: "2.0.0", prod: "1.5.0" },
  "simple-pkg": { dev: "1.0.0" },  // prod defaults to dev version
}
```

### dev

Configuration for development mode.

```javascript
dev: (ctx) => ({
  manager: "store",           // Use DevLink store
  namespaces: ["feature", "global"],  // Namespace precedence
})
```

### prod

Configuration for production mode.

```javascript
prod: (ctx) => ({
  manager: "npm",             // Use npm
  args: ["--no-save"],        // Additional npm arguments
})
```

### detectMode

Function to determine which mode to use.

```javascript
detectMode: (ctx) => {
  // ctx.env - Environment variables
  // ctx.args - Command line arguments
  // ctx.cwd - Current working directory
  
  if (ctx.env.NODE_ENV === "development") return "dev";
  if (ctx.env.SST_LOCAL === "true") return "dev";
  if (ctx.args.includes("--dev")) return "dev";
  return "prod";
}
```

## Context Object

The `ctx` object passed to functions contains:

```typescript
interface Context {
  env: Record<string, string>;  // process.env
  args: string[];               // Command line arguments
  cwd: string;                  // Current working directory
}
```

## Manager Types

### store

Uses the DevLink store to resolve packages:

```javascript
{
  manager: "store",
  namespaces: ["feature-v2", "global"],
  peerOptional: ["@myorg/*"],  // Mark matching deps as optional peers
}
```

#### peerOptional

When DevLink copies packages from the store to `node_modules`, it can automatically transform dependencies to optional peer dependencies. This prevents npm from trying to resolve them from the registry.

```javascript
dev: (ctx) => ({
  manager: "store",
  peerOptional: ["@myorg/*"],  // Glob patterns for packages to transform
})
```

**How it works:**

1. DevLink copies the package from the store to `node_modules`
2. For each dependency that matches a `peerOptional` pattern:
   - Moves it from `dependencies` to `peerDependencies`
   - Adds `peerDependenciesMeta` with `optional: true`
3. npm sees these as optional and doesn't try to resolve them from the registry

**Supported patterns:**

| Pattern | Matches |
|---------|---------|
| `@scope/*` | All packages in scope (e.g., `@myorg/core`, `@myorg/utils`) |
| `@scope/pkg` | Exact package name |
| `*` | All packages |

**Example transformation:**

Original `package.json` in store:
```json
{
  "dependencies": {
    "@myorg/core": "1.0.0",
    "@myorg/utils": "1.0.0",
    "lodash": "4.17.0"
  }
}
```

After DevLink copies with `peerOptional: ["@myorg/*"]`:
```json
{
  "dependencies": {
    "lodash": "4.17.0"
  },
  "peerDependencies": {
    "@myorg/core": "1.0.0",
    "@myorg/utils": "1.0.0"
  },
  "peerDependenciesMeta": {
    "@myorg/core": { "optional": true },
    "@myorg/utils": { "optional": true }
  }
}
```

**Important:** The original package in the store is never modified. Only the copy in `node_modules` is transformed.

**Use case:** When developing a monorepo where packages depend on each other, but those packages aren't published to npm yet. Without `peerOptional`, npm would fail trying to resolve the internal dependencies from the registry.

### npm

Uses npm to install packages:

```javascript
{
  manager: "npm",
  args: ["--no-save", "--legacy-peer-deps"],
}
```

## Complete Example

```javascript
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  // Packages to manage
  packages: {
    "@myorg/core": { dev: "1.0.0", prod: "1.0.0" },
    "@myorg/utils": { dev: "1.0.0", prod: "1.0.0" },
    "@myorg/http": { dev: "1.0.0", prod: "1.0.0" },
  },

  // Development mode: use local store
  dev: (ctx) => ({
    manager: "store",
    namespaces: getNamespaces(ctx),
    // Mark @myorg packages as optional peers so npm doesn't
    // try to resolve them from the registry
    peerOptional: ["@myorg/*"],
  }),

  // Production mode: use npm (no peerOptional needed)
  prod: (ctx) => ({
    manager: "npm",
    args: ["--no-save"],
  }),

  // Mode detection
  detectMode: (ctx) => {
    // SST local development
    if (ctx.env.SST_LOCAL === "true") return "dev";
    
    // Explicit flags
    if (ctx.args.includes("--dev")) return "dev";
    if (ctx.args.includes("--prod")) return "prod";
    
    // Environment variable
    if (ctx.env.NODE_ENV === "development") return "dev";
    
    return "prod";
  },
};

// Helper to determine namespaces based on context
function getNamespaces(ctx) {
  // Use feature namespace if specified
  if (ctx.env.DEVLINK_NAMESPACE) {
    return [ctx.env.DEVLINK_NAMESPACE, "global"];
  }
  
  // Default to global only
  return ["global"];
}
```

## Namespace Override

The `-n` flag overrides configured namespaces:

```bash
# Uses namespaces from config
devlink install

# Overrides to use feature-v2 first
devlink install -n feature-v2,global
```

## Mode Override

The `--dev` and `--prod` flags override mode detection:

```bash
# Uses detectMode function
devlink install

# Forces dev mode
devlink install --dev

# Forces prod mode
devlink install --prod
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
  "@scope/core": { dev: "1.2.3", prod: "1.2.3" },
}
```

### Different Dev/Prod Versions

Use different versions for development and production:

```javascript
packages: {
  "@scope/core": { 
    dev: "2.0.0-beta.1",  // Latest beta for development
    prod: "1.5.0",         // Stable for production
  },
}
```

## See Also

- [Install Command](install.md) - Using the configuration
- [Namespaces](../store/namespaces.md) - Understanding namespace precedence
