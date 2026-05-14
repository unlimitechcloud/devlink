# CLI Testing Infrastructure — Fixture & Test Guide

This document describes the CLI integration testing strategy for DevLink. Tests execute the compiled CLI binary (`dist/cli.js`) as a subprocess, using compressed fixture archives and isolated temp stores.

## Fixture Categories

### Publishers (`fixtures/publishers/`)

Pre-built package directories compressed as tar.gz. Each archive contains a single top-level directory matching the fixture name.

| Fixture | Package Name | Version | Key Characteristics |
|---------|-------------|---------|---------------------|
| `simple-lib` | `@test/simple-lib` | 1.0.0 | Basic library with dist/index.js + dist/index.d.ts |
| `simple-lib-v2` | `@test/simple-lib` | 2.0.0 | Updated version with additional exports |
| `lib-with-deps` | `@test/lib-with-deps` | 1.0.0 | Library depending on @test/simple-lib |
| `lib-with-bin` | `@test/cli-tool` | 1.0.0 | Library with bin entries |
| `synthetic-pkg` | `@test/synthetic-sst` | 1.0.0 | Package with peerDependencies (used as synthetic) |

### Consumers (`fixtures/consumers/`)

Pre-built project directories with DevLink configuration files.

| Fixture | Config Style | Key Characteristics |
|---------|-------------|---------------------|
| `consumer-modes` | V2 modes object | `modes.default: "dev"`, manager: "store", workspaces |
| `consumer-legacy` | Legacy format | Direct packages + mode factory at root level |
| `consumer-synthetic` | V2 modes object | Includes packages with `synthetic: true` |

## Creating New Fixtures

### Publisher Fixture

```bash
# 1. Create the fixture directory
mkdir -p fixtures/publishers/my-new-lib
cd fixtures/publishers/my-new-lib

# 2. Create package.json
cat > package.json << 'EOF'
{
  "name": "@test/my-new-lib",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"]
}
EOF

# 3. Create source files
mkdir -p dist
echo 'export function hello() { return "world"; }' > dist/index.js
echo 'export declare function hello(): string;' > dist/index.d.ts

# 4. Compress and remove directory
cd ..
tar -czf my-new-lib.tar.gz my-new-lib/
rm -rf my-new-lib/
```

### Consumer Fixture

```bash
# 1. Create the fixture directory
mkdir -p fixtures/consumers/consumer-custom
cd fixtures/consumers/consumer-custom

# 2. Create package.json
cat > package.json << 'EOF'
{
  "name": "@test/consumer-custom",
  "version": "1.0.0",
  "private": true
}
EOF

# 3. Create devlink.config.mjs
cat > devlink.config.mjs << 'EOF'
export default {
  modes: {
    default: "dev",
    dev: () => ({ manager: "store" }),
  },
  packages: {
    "@test/simple-lib": { version: "1.0.0" },
  },
};
EOF

# 4. Compress and remove directory
cd ..
tar -czf consumer-custom.tar.gz consumer-custom/
rm -rf consumer-custom/
```

## Updating Existing Fixtures

```bash
# 1. Decompress
cd fixtures/publishers/
tar -xzf simple-lib.tar.gz

# 2. Modify files inside simple-lib/
# ...

# 3. Recompress and remove
tar -czf simple-lib.tar.gz simple-lib/
rm -rf simple-lib/
```

## CLI Test Utility API

### `execCli(args, options): CliResult`

Executes the compiled DevLink CLI binary as a subprocess. Never throws — non-zero exit codes are captured in the result.

```typescript
import { execCli, type CliResult, type CliOptions } from "./helpers/cli.js";
```

**Parameters:**
- `args: string[]` — CLI arguments (e.g., `["publish", "--json", "-n", "feature"]`)
- `options: CliOptions` — Execution options

**CliOptions:**
```typescript
interface CliOptions {
  cwd?: string;           // Working directory for the command
  repo: string;           // Path to temp store (passed as --repo)
  env?: Record<string, string>;  // Environment variables
}
```

**CliResult:**
```typescript
interface CliResult {
  exitCode: number;       // Process exit code (0 = success)
  stdout: string;         // Raw stdout string
  stderr: string;         // Raw stderr string
  json: any | null;       // Parsed JSON if stdout is valid JSON, else null
}
```

### Fixture Utilities

```typescript
import {
  decompressPublisher,
  decompressConsumer,
  createTempStore,
  cleanupTemp,
} from "./helpers/fixtures.js";
```

| Function | Returns | Description |
|----------|---------|-------------|
| `decompressPublisher(name)` | `Promise<string>` | Decompresses publisher fixture to unique temp dir |
| `decompressConsumer(name)` | `Promise<string>` | Decompresses consumer fixture to unique temp dir |
| `createTempStore()` | `Promise<string>` | Creates empty temp dir for use as `--repo` target |
| `cleanupTemp(path)` | `Promise<void>` | Removes temp dir recursively (idempotent) |

**Important:** `decompressPublisher` returns the parent temp directory. The fixture contents are at `join(result, fixtureName)`.

## Test Scenario Examples

### Publishing and Verification

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { execCli } from "./helpers/cli.js";
import { decompressPublisher, createTempStore, cleanupTemp } from "./helpers/fixtures.js";

describe("CLI: My Feature", { timeout: 30000 }, () => {
  let storePath: string;
  let fixturePath: string;
  let tempDirs: string[] = [];

  beforeAll(async () => {
    storePath = await createTempStore();
    const pubDir = await decompressPublisher("simple-lib");
    fixturePath = join(pubDir, "simple-lib");
    tempDirs.push(pubDir);
  });

  afterAll(async () => {
    await cleanupTemp(storePath);
    for (const d of tempDirs) await cleanupTemp(d);
  });

  it("publishes and verifies via list", () => {
    const pub = execCli(["publish", "--json"], { cwd: fixturePath, repo: storePath });
    expect(pub.exitCode).toBe(0);
    expect(pub.json.name).toBe("@test/simple-lib");

    const list = execCli(["list", "--json"], { repo: storePath });
    expect(list.json.namespaces.global.packages["@test/simple-lib"]).toBeDefined();
  });
});
```

### Plan Resolution with Consumer Fixtures

```typescript
it("resolves packages from store via plan", () => {
  // Pre-publish fixtures to store
  execCli(["publish", "--json"], { cwd: simpleLibPath, repo: storePath });

  // Run plan with consumer fixture
  const result = execCli(
    ["plan", "--json", "--mode", "dev"],
    { cwd: consumerModesPath, repo: storePath }
  );
  expect(result.exitCode).toBe(0);
  expect(result.json.packages.store.length).toBeGreaterThan(0);
});
```

### Error Case Testing

```typescript
it("returns error for non-existent package", () => {
  const result = execCli(
    ["resolve", "@test/nonexistent@1.0.0", "--json"],
    { repo: storePath }
  );
  // resolve exits with code 2 when packages are not found
  expect(result.exitCode).toBe(2);
  expect(result.json.results[0].resolved).toBe(false);
});
```

## Naming Conventions

- **Publisher fixtures:** Named after the package concept, not the npm name (e.g., `simple-lib` not `test-simple-lib`)
- **Consumer fixtures:** Prefixed with `consumer-` followed by the config style (e.g., `consumer-modes`, `consumer-legacy`)
- **Test files:** `cli-<domain>.spec.ts` (e.g., `cli-publish.spec.ts`, `cli-maintenance.spec.ts`)
- **Temp directories:** Auto-generated with prefixes `devlink-pub-`, `devlink-con-`, `devlink-store-`

## Important Notes

- **Build first:** CLI tests require `npm run build` before running since they execute `dist/cli.js`
- **Timeout:** Use `{ timeout: 30000 }` on describe blocks — CLI tests spawn subprocesses
- **No-throw:** `execCli` never throws. Assert on `exitCode` for error cases
- **JSON mode:** Always use `--json` flag for assertions. Human output is for display only
- **Store isolation:** Every test suite gets its own temp store via `createTempStore()`
- **Cleanup:** Always clean up temp dirs in `afterAll` to avoid disk accumulation
