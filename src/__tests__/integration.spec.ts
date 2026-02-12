/**
 * Integration Tests - Tests con módulos reales y fixtures
 * 
 * Estos tests importan los módulos reales y verifican el comportamiento
 * completo del sistema usando los fixtures.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.resolve(__dirname, "../../fixtures/packages");
const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-integration-" + Date.now());

// Mock constants before importing modules
vi.mock("../constants.js", async () => {
  const actual = await vi.importActual("../constants.js");
  return {
    ...actual,
    getStorePath: () => TEST_STORE_PATH,
    getNamespacesPath: () => path.join(TEST_STORE_PATH, "namespaces"),
    getNamespacePath: (ns: string) => path.join(TEST_STORE_PATH, "namespaces", ns),
    getPackagePath: (ns: string, pkg: string, ver: string) =>
      path.join(TEST_STORE_PATH, "namespaces", ns, pkg, ver),
    getRegistryPath: () => path.join(TEST_STORE_PATH, "registry.json"),
    getInstallationsPath: () => path.join(TEST_STORE_PATH, "installations.json"),
    getLockPath: () => path.join(TEST_STORE_PATH, ".lock"),
  };
});

// Import modules after mocking
import { publishPackage } from "../commands/publish.js";
import { listPackages } from "../commands/list.js";
import { resolvePackagesCommand } from "../commands/resolve.js";
import { removeFromStore } from "../commands/remove.js";
import { verifyStore } from "../commands/verify.js";
import { pruneStore } from "../commands/prune.js";
import { readRegistry } from "../core/registry.js";

describe("Integration: Full Workflow", () => {
  beforeEach(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
  });

  describe("Publish Workflow", () => {
    it("should publish @test/sample-lib v1.0.0 to global namespace", async () => {
      const fixturePath = path.join(FIXTURES_PATH, "@test/sample-lib-v1");
      
      const result = await publishPackage(fixturePath, "global");
      
      expect(result.name).toBe("@test/sample-lib");
      expect(result.version).toBe("1.0.0");
      expect(result.namespace).toBe("global");
      expect(result.signature).toHaveLength(32); // MD5 hash
      expect(result.files).toBeGreaterThan(0);

      // Verify physical structure
      const pkgPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/@test/sample-lib/1.0.0"
      );
      await expect(fs.access(pkgPath)).resolves.not.toThrow();
      await expect(fs.access(path.join(pkgPath, "package.json"))).resolves.not.toThrow();
      await expect(fs.access(path.join(pkgPath, "dist/index.js"))).resolves.not.toThrow();

      // Verify registry
      const registry = await readRegistry();
      expect(registry.namespaces.global.packages["@test/sample-lib"]).toBeDefined();
      expect(registry.namespaces.global.packages["@test/sample-lib"].versions["1.0.0"]).toBeDefined();
      expect(registry.namespaces.global.packages["@test/sample-lib"].versions["1.0.0"].signature).toBe(result.signature);
    });

    it("should publish multiple versions of same package", async () => {
      const v1Path = path.join(FIXTURES_PATH, "@test/sample-lib-v1");
      const v2Path = path.join(FIXTURES_PATH, "@test/sample-lib-v2");

      await publishPackage(v1Path, "global");
      await publishPackage(v2Path, "global");

      // Verify both versions exist
      const registry = await readRegistry();
      const versions = Object.keys(
        registry.namespaces.global.packages["@test/sample-lib"].versions
      );
      expect(versions).toContain("1.0.0");
      expect(versions).toContain("2.0.0");

      // Verify physical files
      const v1PkgPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/@test/sample-lib/1.0.0/package.json"
      );
      const v2PkgPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/@test/sample-lib/2.0.0/package.json"
      );

      const v1Pkg = JSON.parse(await fs.readFile(v1PkgPath, "utf-8"));
      const v2Pkg = JSON.parse(await fs.readFile(v2PkgPath, "utf-8"));

      expect(v1Pkg.version).toBe("1.0.0");
      expect(v2Pkg.version).toBe("2.0.0");
    });

    it("should publish same package to different namespaces", async () => {
      const fixturePath = path.join(FIXTURES_PATH, "@test/sample-lib-v1");

      await publishPackage(fixturePath, "global");
      await publishPackage(fixturePath, "feature-branch");

      // Verify registry
      const registry = await readRegistry();
      expect(registry.namespaces.global.packages["@test/sample-lib"]).toBeDefined();
      expect(registry.namespaces["feature-branch"].packages["@test/sample-lib"]).toBeDefined();

      // Verify physical structure
      const globalPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/@test/sample-lib/1.0.0"
      );
      const featurePath = path.join(
        TEST_STORE_PATH,
        "namespaces/feature-branch/@test/sample-lib/1.0.0"
      );

      await expect(fs.access(globalPath)).resolves.not.toThrow();
      await expect(fs.access(featurePath)).resolves.not.toThrow();
    });

    it("should publish non-scoped package", async () => {
      const fixturePath = path.join(FIXTURES_PATH, "utils-helper");

      const result = await publishPackage(fixturePath, "global");

      expect(result.name).toBe("utils-helper");
      expect(result.version).toBe("1.0.0");

      // Verify physical structure (no @ scope directory)
      const pkgPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/utils-helper/1.0.0"
      );
      await expect(fs.access(pkgPath)).resolves.not.toThrow();
    });
  });

  describe("List Workflow", () => {
    beforeEach(async () => {
      // Publish test packages
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v1"), "global");
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v2"), "global");
      await publishPackage(path.join(FIXTURES_PATH, "utils-helper"), "global");
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v1"), "feature");
    });

    it("should list all packages by namespace", async () => {
      const output = await listPackages();

      expect(output).toContain("global/");
      expect(output).toContain("feature/");
      expect(output).toContain("@test/");
      expect(output).toContain("sample-lib/");
      expect(output).toContain("utils-helper/");
      expect(output).toContain("1.0.0");
      expect(output).toContain("2.0.0");
    });

    it("should filter by namespace", async () => {
      const output = await listPackages({ namespaces: ["feature"] });

      expect(output).toContain("feature/");
      expect(output).not.toContain("global/");
    });

    it("should list by package", async () => {
      const output = await listPackages({
        packages: ["@test/sample-lib"],
        byPackage: true,
      });

      expect(output).toContain("@test/");
      expect(output).toContain("sample-lib/");
      expect(output).toContain("global/");
      expect(output).toContain("feature/");
      expect(output).not.toContain("utils-helper");
    });

    it("should filter by scope", async () => {
      const output = await listPackages({
        packages: ["@test"],
        byPackage: true,
      });

      expect(output).toContain("@test/");
      expect(output).not.toContain("utils-helper");
    });
  });

  describe("Resolve Workflow", () => {
    beforeEach(async () => {
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v1"), "global");
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v2"), "global");
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v1"), "feature");
    });

    it("should resolve from global namespace", async () => {
      const output = await resolvePackagesCommand(["@test/sample-lib@1.0.0"]);

      expect(output).toContain("✓");
      expect(output).toContain("global");
    });

    it("should resolve from feature namespace first", async () => {
      const output = await resolvePackagesCommand(
        ["@test/sample-lib@1.0.0"],
        { namespaces: ["feature", "global"] }
      );

      expect(output).toContain("feature");
    });

    it("should fall back to global for v2", async () => {
      const output = await resolvePackagesCommand(
        ["@test/sample-lib@2.0.0"],
        { namespaces: ["feature", "global"] }
      );

      expect(output).toContain("global");
    });

    it("should show not found for missing version", async () => {
      const output = await resolvePackagesCommand(["@test/sample-lib@3.0.0"]);

      expect(output).toContain("✗");
      expect(output).toContain("not found");
    });
  });

  describe("Remove Workflow", () => {
    beforeEach(async () => {
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v1"), "global");
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v2"), "global");
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v1"), "feature");
    });

    it("should remove specific version", async () => {
      const result = await removeFromStore("@test/sample-lib@1.0.0", { namespace: "global" });

      expect(result.type).toBe("version");
      expect(result.version).toBe("1.0.0");

      // Verify physical removal
      const removedPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/@test/sample-lib/1.0.0"
      );
      await expect(fs.access(removedPath)).rejects.toThrow();

      // v2 should still exist
      const v2Path = path.join(
        TEST_STORE_PATH,
        "namespaces/global/@test/sample-lib/2.0.0"
      );
      await expect(fs.access(v2Path)).resolves.not.toThrow();

      // Registry should be updated
      const registry = await readRegistry();
      expect(registry.namespaces.global.packages["@test/sample-lib"].versions["1.0.0"]).toBeUndefined();
      expect(registry.namespaces.global.packages["@test/sample-lib"].versions["2.0.0"]).toBeDefined();
    });

    it("should remove entire package", async () => {
      const result = await removeFromStore("@test/sample-lib", { namespace: "global" });

      expect(result.type).toBe("package");

      // Verify physical removal
      const pkgPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/@test/sample-lib"
      );
      await expect(fs.access(pkgPath)).rejects.toThrow();

      // Registry should be updated
      const registry = await readRegistry();
      expect(registry.namespaces.global.packages["@test/sample-lib"]).toBeUndefined();
    });

    it("should remove namespace", async () => {
      const result = await removeFromStore("feature");

      expect(result.type).toBe("namespace");

      // Verify physical removal
      const nsPath = path.join(TEST_STORE_PATH, "namespaces/feature");
      await expect(fs.access(nsPath)).rejects.toThrow();

      // Registry should be updated
      const registry = await readRegistry();
      expect(registry.namespaces.feature).toBeUndefined();
    });

    it("should not remove global namespace", async () => {
      await expect(removeFromStore("global")).rejects.toThrow(
        "Cannot delete reserved namespace 'global'"
      );
    });
  });

  describe("Verify Workflow", () => {
    it("should detect orphaned files on disk", async () => {
      // Publish package
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v1"), "global");

      // Create orphan manually
      const orphanPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/orphan-pkg/1.0.0"
      );
      await fs.mkdir(orphanPath, { recursive: true });
      await fs.writeFile(
        path.join(orphanPath, "package.json"),
        JSON.stringify({ name: "orphan-pkg", version: "1.0.0" })
      );

      const result = await verifyStore(false);

      expect(result.orphansOnDisk.length).toBeGreaterThan(0);
      expect(result.orphansOnDisk.some(o => o.package === "orphan-pkg")).toBe(true);
    });

    it("should fix orphaned files with --fix", async () => {
      // Create orphan
      const orphanPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/orphan-pkg/1.0.0"
      );
      await fs.mkdir(orphanPath, { recursive: true });
      await fs.writeFile(
        path.join(orphanPath, "package.json"),
        JSON.stringify({ name: "orphan-pkg", version: "1.0.0" })
      );

      // Initialize registry
      await publishPackage(path.join(FIXTURES_PATH, "utils-helper"), "global");

      const result = await verifyStore(true);

      expect(result.fixed).toBe(true);

      // Orphan should be removed
      await expect(fs.access(orphanPath)).rejects.toThrow();
    });
  });

  describe("Prune Workflow", () => {
    it("should remove orphaned packages", async () => {
      // Publish package
      await publishPackage(path.join(FIXTURES_PATH, "@test/sample-lib-v1"), "global");

      // Create orphan
      const orphanPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/orphan-pkg/1.0.0"
      );
      await fs.mkdir(orphanPath, { recursive: true });
      await fs.writeFile(
        path.join(orphanPath, "package.json"),
        JSON.stringify({ name: "orphan-pkg", version: "1.0.0" })
      );

      const result = await pruneStore();

      expect(result.removed.length).toBeGreaterThan(0);
      expect(result.removed.some(r => r.package === "orphan-pkg")).toBe(true);

      // Orphan should be removed
      await expect(fs.access(orphanPath)).rejects.toThrow();
    });

    it("should support dry-run", async () => {
      // Create orphan
      const orphanPath = path.join(
        TEST_STORE_PATH,
        "namespaces/global/orphan-pkg/1.0.0"
      );
      await fs.mkdir(orphanPath, { recursive: true });
      await fs.writeFile(
        path.join(orphanPath, "package.json"),
        JSON.stringify({ name: "orphan-pkg", version: "1.0.0" })
      );

      // Initialize registry
      await publishPackage(path.join(FIXTURES_PATH, "utils-helper"), "global");

      const result = await pruneStore({ dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.removed.length).toBeGreaterThan(0);

      // Orphan should still exist
      await expect(fs.access(orphanPath)).resolves.not.toThrow();
    });
  });
});
