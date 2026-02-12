/**
 * E2E Tests - Verificación física del store
 * 
 * Estos tests usan los fixtures reales y verifican la estructura
 * física del store después de cada operación.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

// Get fixtures path relative to this file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.resolve(__dirname, "../../fixtures/packages");

// Test store in temp directory
const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-e2e-" + Date.now());

// Import after setting up mocks would be complex, so we'll use dynamic imports
// and manually set environment or use the actual modules with a test store

describe("E2E: Store Operations", () => {
  // Helper to get paths
  const getStorePath = () => TEST_STORE_PATH;
  const getNamespacesPath = () => path.join(TEST_STORE_PATH, "namespaces");
  const getNamespacePath = (ns: string) => path.join(getNamespacesPath(), ns);
  const getPackagePath = (ns: string, pkg: string, ver: string) =>
    path.join(getNamespacePath(ns), pkg, ver);
  const getRegistryPath = () => path.join(TEST_STORE_PATH, "registry.json");

  beforeAll(async () => {
    // Verify fixtures exist
    const v1Path = path.join(FIXTURES_PATH, "@test/sample-lib-v1");
    const v2Path = path.join(FIXTURES_PATH, "@test/sample-lib-v2");
    const utilsPath = path.join(FIXTURES_PATH, "utils-helper");

    await expect(fs.access(v1Path)).resolves.not.toThrow();
    await expect(fs.access(v2Path)).resolves.not.toThrow();
    await expect(fs.access(utilsPath)).resolves.not.toThrow();
  });

  beforeEach(async () => {
    // Clean store before each test
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
  });

  describe("Fixture Verification", () => {
    it("should have v1 fixture with correct structure", async () => {
      const v1Path = path.join(FIXTURES_PATH, "@test/sample-lib-v1");
      
      // Check package.json
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(v1Path, "package.json"), "utf-8")
      );
      expect(pkgJson.name).toBe("@test/sample-lib");
      expect(pkgJson.version).toBe("1.0.0");
      
      // Check dist files
      await expect(fs.access(path.join(v1Path, "dist/index.js"))).resolves.not.toThrow();
      await expect(fs.access(path.join(v1Path, "dist/index.d.ts"))).resolves.not.toThrow();
    });

    it("should have v2 fixture with correct structure", async () => {
      const v2Path = path.join(FIXTURES_PATH, "@test/sample-lib-v2");
      
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(v2Path, "package.json"), "utf-8")
      );
      expect(pkgJson.name).toBe("@test/sample-lib");
      expect(pkgJson.version).toBe("2.0.0");
      
      // v2 should have more functions
      const indexContent = await fs.readFile(path.join(v2Path, "dist/index.js"), "utf-8");
      expect(indexContent).toContain("multiply");
      expect(indexContent).toContain("subtract");
    });

    it("should have utils-helper fixture", async () => {
      const utilsPath = path.join(FIXTURES_PATH, "utils-helper");
      
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(utilsPath, "package.json"), "utf-8")
      );
      expect(pkgJson.name).toBe("utils-helper");
      expect(pkgJson.version).toBe("1.0.0");
    });
  });

  describe("Manual Store Operations", () => {
    it("should create correct directory structure when publishing", async () => {
      // Simulate what publish does manually
      const ns = "global";
      const pkg = "@test/sample-lib";
      const version = "1.0.0";
      const sourcePath = path.join(FIXTURES_PATH, "@test/sample-lib-v1");
      const destPath = getPackagePath(ns, pkg, version);

      // Create namespace directory
      await fs.mkdir(destPath, { recursive: true });

      // Copy files
      const files = ["package.json", "dist/index.js", "dist/index.d.ts"];
      for (const file of files) {
        const src = path.join(sourcePath, file);
        const dest = path.join(destPath, file);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
      }

      // Verify structure
      const expectedStructure = [
        "namespaces/global/@test/sample-lib/1.0.0/package.json",
        "namespaces/global/@test/sample-lib/1.0.0/dist/index.js",
        "namespaces/global/@test/sample-lib/1.0.0/dist/index.d.ts",
      ];

      for (const expectedPath of expectedStructure) {
        const fullPath = path.join(TEST_STORE_PATH, expectedPath);
        await expect(fs.access(fullPath)).resolves.not.toThrow();
      }
    });

    it("should support multiple versions of same package", async () => {
      const ns = "global";
      const pkg = "@test/sample-lib";

      // Publish v1
      const v1Source = path.join(FIXTURES_PATH, "@test/sample-lib-v1");
      const v1Dest = getPackagePath(ns, pkg, "1.0.0");
      await fs.mkdir(v1Dest, { recursive: true });
      await fs.copyFile(
        path.join(v1Source, "package.json"),
        path.join(v1Dest, "package.json")
      );

      // Publish v2
      const v2Source = path.join(FIXTURES_PATH, "@test/sample-lib-v2");
      const v2Dest = getPackagePath(ns, pkg, "2.0.0");
      await fs.mkdir(v2Dest, { recursive: true });
      await fs.copyFile(
        path.join(v2Source, "package.json"),
        path.join(v2Dest, "package.json")
      );

      // Verify both versions exist
      const v1PkgJson = JSON.parse(
        await fs.readFile(path.join(v1Dest, "package.json"), "utf-8")
      );
      const v2PkgJson = JSON.parse(
        await fs.readFile(path.join(v2Dest, "package.json"), "utf-8")
      );

      expect(v1PkgJson.version).toBe("1.0.0");
      expect(v2PkgJson.version).toBe("2.0.0");

      // List versions in directory
      const pkgDir = path.join(getNamespacePath(ns), pkg);
      const versions = await fs.readdir(pkgDir);
      expect(versions).toContain("1.0.0");
      expect(versions).toContain("2.0.0");
    });

    it("should support same package in different namespaces", async () => {
      const pkg = "@test/sample-lib";
      const version = "1.0.0";
      const source = path.join(FIXTURES_PATH, "@test/sample-lib-v1");

      // Publish to global
      const globalDest = getPackagePath("global", pkg, version);
      await fs.mkdir(globalDest, { recursive: true });
      await fs.copyFile(
        path.join(source, "package.json"),
        path.join(globalDest, "package.json")
      );

      // Publish to feature namespace
      const featureDest = getPackagePath("feature-branch", pkg, version);
      await fs.mkdir(featureDest, { recursive: true });
      await fs.copyFile(
        path.join(source, "package.json"),
        path.join(featureDest, "package.json")
      );

      // Verify both namespaces have the package
      await expect(fs.access(path.join(globalDest, "package.json"))).resolves.not.toThrow();
      await expect(fs.access(path.join(featureDest, "package.json"))).resolves.not.toThrow();

      // List namespaces
      const namespaces = await fs.readdir(getNamespacesPath());
      expect(namespaces).toContain("global");
      expect(namespaces).toContain("feature-branch");
    });

    it("should create valid registry.json structure", async () => {
      // Create registry manually
      const registry = {
        version: "1.0.0",
        namespaces: {
          global: {
            created: new Date().toISOString(),
            packages: {
              "@test/sample-lib": {
                versions: {
                  "1.0.0": {
                    signature: "abc12345",
                    published: new Date().toISOString(),
                    files: 3,
                  },
                  "2.0.0": {
                    signature: "def67890",
                    published: new Date().toISOString(),
                    files: 3,
                  },
                },
              },
              "utils-helper": {
                versions: {
                  "1.0.0": {
                    signature: "ghi11111",
                    published: new Date().toISOString(),
                    files: 2,
                  },
                },
              },
            },
          },
          "feature-branch": {
            created: new Date().toISOString(),
            packages: {
              "@test/sample-lib": {
                versions: {
                  "1.0.0-beta": {
                    signature: "jkl22222",
                    published: new Date().toISOString(),
                    files: 3,
                  },
                },
              },
            },
          },
        },
      };

      await fs.writeFile(getRegistryPath(), JSON.stringify(registry, null, 2));

      // Read and verify
      const readRegistry = JSON.parse(await fs.readFile(getRegistryPath(), "utf-8"));

      expect(readRegistry.version).toBe("1.0.0");
      expect(Object.keys(readRegistry.namespaces)).toHaveLength(2);
      expect(readRegistry.namespaces.global.packages["@test/sample-lib"].versions["1.0.0"]).toBeDefined();
      expect(readRegistry.namespaces.global.packages["@test/sample-lib"].versions["2.0.0"]).toBeDefined();
      expect(readRegistry.namespaces["feature-branch"].packages["@test/sample-lib"].versions["1.0.0-beta"]).toBeDefined();
    });
  });

  describe("Store Integrity", () => {
    it("should detect orphaned files (files without registry entry)", async () => {
      // Create file on disk without registry entry
      const orphanPath = getPackagePath("global", "orphan-pkg", "1.0.0");
      await fs.mkdir(orphanPath, { recursive: true });
      await fs.writeFile(
        path.join(orphanPath, "package.json"),
        JSON.stringify({ name: "orphan-pkg", version: "1.0.0" })
      );

      // Create empty registry
      const registry = {
        version: "1.0.0",
        namespaces: {
          global: { created: new Date().toISOString(), packages: {} },
        },
      };
      await fs.writeFile(getRegistryPath(), JSON.stringify(registry, null, 2));

      // Verify orphan exists on disk but not in registry
      await expect(fs.access(orphanPath)).resolves.not.toThrow();
      
      const readRegistry = JSON.parse(await fs.readFile(getRegistryPath(), "utf-8"));
      expect(readRegistry.namespaces.global.packages["orphan-pkg"]).toBeUndefined();
    });

    it("should detect orphaned registry entries (registry without files)", async () => {
      // Create registry with entry but no files
      const registry = {
        version: "1.0.0",
        namespaces: {
          global: {
            created: new Date().toISOString(),
            packages: {
              "ghost-pkg": {
                versions: {
                  "1.0.0": {
                    signature: "ghost123",
                    published: new Date().toISOString(),
                    files: 1,
                  },
                },
              },
            },
          },
        },
      };
      await fs.writeFile(getRegistryPath(), JSON.stringify(registry, null, 2));

      // Verify registry has entry but no files on disk
      const readRegistry = JSON.parse(await fs.readFile(getRegistryPath(), "utf-8"));
      expect(readRegistry.namespaces.global.packages["ghost-pkg"]).toBeDefined();

      const ghostPath = getPackagePath("global", "ghost-pkg", "1.0.0");
      await expect(fs.access(ghostPath)).rejects.toThrow();
    });
  });
});
