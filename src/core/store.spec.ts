/**
 * Store - Unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  ensureStore,
  ensureNamespace,
  namespaceExists,
  listNamespaces,
  packageVersionExists,
  listPackagesInNamespace,
  listVersionsInNamespace,
  deletePackageVersion,
  deletePackage,
  deleteNamespace,
  readPackageSignature,
  writePackageSignature,
  getNamespaceDiskUsage,
  findOrphanedPackages,
} from "./store.js";

const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-store-test-" + Date.now());

vi.mock("../constants.js", () => ({
  getStorePath: () => TEST_STORE_PATH,
  getNamespacesPath: () => path.join(TEST_STORE_PATH, "namespaces"),
  getNamespacePath: (ns: string) => path.join(TEST_STORE_PATH, "namespaces", ns),
  getPackagePath: (ns: string, pkg: string, ver: string) => 
    path.join(TEST_STORE_PATH, "namespaces", ns, pkg, ver),
  DEFAULT_NAMESPACE: "global",
  SIGNATURE_FILE: "devlink.sig",
}));

describe("Store", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
  });

  describe("ensureStore", () => {
    it("should create store directory", async () => {
      await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
      
      await ensureStore();
      
      const stat = await fs.stat(TEST_STORE_PATH);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe("ensureNamespace", () => {
    it("should create namespace directory", async () => {
      await ensureNamespace("test-ns");
      
      const nsPath = path.join(TEST_STORE_PATH, "namespaces", "test-ns");
      const stat = await fs.stat(nsPath);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe("namespaceExists", () => {
    it("should return true for existing namespace", async () => {
      await ensureNamespace("test-ns");
      
      const exists = await namespaceExists("test-ns");
      expect(exists).toBe(true);
    });

    it("should return false for non-existent namespace", async () => {
      const exists = await namespaceExists("nonexistent");
      expect(exists).toBe(false);
    });
  });

  describe("listNamespaces", () => {
    it("should list all namespaces", async () => {
      await ensureNamespace("global");
      await ensureNamespace("feature");
      await ensureNamespace("alpha");
      
      const namespaces = await listNamespaces();
      
      expect(namespaces).toContain("global");
      expect(namespaces).toContain("feature");
      expect(namespaces).toContain("alpha");
    });

    it("should return global first", async () => {
      await ensureNamespace("zzz");
      await ensureNamespace("global");
      await ensureNamespace("aaa");
      
      const namespaces = await listNamespaces();
      
      expect(namespaces[0]).toBe("global");
    });

    it("should return empty array when no namespaces", async () => {
      const namespaces = await listNamespaces();
      expect(namespaces).toEqual([]);
    });
  });

  describe("packageVersionExists", () => {
    it("should return true for existing package", async () => {
      const pkgPath = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "1.0.0");
      await fs.mkdir(pkgPath, { recursive: true });
      
      const exists = await packageVersionExists("global", "pkg", "1.0.0");
      expect(exists).toBe(true);
    });

    it("should return false for non-existent package", async () => {
      const exists = await packageVersionExists("global", "pkg", "1.0.0");
      expect(exists).toBe(false);
    });
  });

  describe("listPackagesInNamespace", () => {
    it("should list simple packages", async () => {
      const pkgPath = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg1", "1.0.0");
      await fs.mkdir(pkgPath, { recursive: true });
      const pkg2Path = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg2", "1.0.0");
      await fs.mkdir(pkg2Path, { recursive: true });
      
      const packages = await listPackagesInNamespace("global");
      
      expect(packages).toContain("pkg1");
      expect(packages).toContain("pkg2");
    });

    it("should list scoped packages", async () => {
      const pkgPath = path.join(TEST_STORE_PATH, "namespaces", "global", "@scope", "pkg", "1.0.0");
      await fs.mkdir(pkgPath, { recursive: true });
      
      const packages = await listPackagesInNamespace("global");
      
      expect(packages).toContain("@scope/pkg");
    });

    it("should return empty array for non-existent namespace", async () => {
      const packages = await listPackagesInNamespace("nonexistent");
      expect(packages).toEqual([]);
    });
  });

  describe("listVersionsInNamespace", () => {
    it("should list all versions", async () => {
      const v1Path = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "1.0.0");
      const v2Path = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "2.0.0");
      await fs.mkdir(v1Path, { recursive: true });
      await fs.mkdir(v2Path, { recursive: true });
      
      const versions = await listVersionsInNamespace("global", "pkg");
      
      expect(versions).toContain("1.0.0");
      expect(versions).toContain("2.0.0");
    });

    it("should return empty array for non-existent package", async () => {
      const versions = await listVersionsInNamespace("global", "nonexistent");
      expect(versions).toEqual([]);
    });
  });

  describe("deletePackageVersion", () => {
    it("should delete package version", async () => {
      const pkgPath = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "1.0.0");
      await fs.mkdir(pkgPath, { recursive: true });
      await fs.writeFile(path.join(pkgPath, "index.js"), "// test");
      
      await deletePackageVersion("global", "pkg", "1.0.0");
      
      const exists = await packageVersionExists("global", "pkg", "1.0.0");
      expect(exists).toBe(false);
    });
  });

  describe("deletePackage", () => {
    it("should delete entire package", async () => {
      const v1Path = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "1.0.0");
      const v2Path = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "2.0.0");
      await fs.mkdir(v1Path, { recursive: true });
      await fs.mkdir(v2Path, { recursive: true });
      
      await deletePackage("global", "pkg");
      
      const packages = await listPackagesInNamespace("global");
      expect(packages).not.toContain("pkg");
    });
  });

  describe("deleteNamespace", () => {
    it("should delete namespace", async () => {
      await ensureNamespace("test-ns");
      
      await deleteNamespace("test-ns");
      
      const exists = await namespaceExists("test-ns");
      expect(exists).toBe(false);
    });

    it("should throw when deleting global", async () => {
      await expect(deleteNamespace("global"))
        .rejects.toThrow("Cannot delete reserved namespace 'global'");
    });
  });

  describe("readPackageSignature / writePackageSignature", () => {
    it("should write and read signature", async () => {
      const pkgPath = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "1.0.0");
      await fs.mkdir(pkgPath, { recursive: true });
      
      await writePackageSignature("global", "pkg", "1.0.0", "abc123");
      const sig = await readPackageSignature("global", "pkg", "1.0.0");
      
      expect(sig).toBe("abc123");
    });

    it("should return null for non-existent signature", async () => {
      const sig = await readPackageSignature("global", "pkg", "1.0.0");
      expect(sig).toBeNull();
    });
  });

  describe("getNamespaceDiskUsage", () => {
    it("should calculate disk usage", async () => {
      const pkgPath = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "1.0.0");
      await fs.mkdir(pkgPath, { recursive: true });
      await fs.writeFile(path.join(pkgPath, "index.js"), "// test content here");
      
      const usage = await getNamespaceDiskUsage("global");
      
      expect(usage).toBeGreaterThan(0);
    });
  });

  describe("findOrphanedPackages", () => {
    it("should find packages not in registry", async () => {
      const pkgPath = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "1.0.0");
      await fs.mkdir(pkgPath, { recursive: true });
      
      const registered = new Set<string>();
      const orphans = await findOrphanedPackages("global", registered);
      
      expect(orphans).toHaveLength(1);
      expect(orphans[0]).toEqual({ packageName: "pkg", version: "1.0.0" });
    });

    it("should not include registered packages", async () => {
      const pkgPath = path.join(TEST_STORE_PATH, "namespaces", "global", "pkg", "1.0.0");
      await fs.mkdir(pkgPath, { recursive: true });
      
      const registered = new Set(["pkg@1.0.0"]);
      const orphans = await findOrphanedPackages("global", registered);
      
      expect(orphans).toHaveLength(0);
    });
  });
});
