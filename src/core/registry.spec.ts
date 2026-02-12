/**
 * Registry - Unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  createEmptyRegistry,
  readRegistry,
  writeRegistry,
  ensureNamespaceInRegistry,
  addPackageToRegistry,
  removePackageFromRegistry,
  getPackageFromRegistry,
  getVersionFromRegistry,
  namespaceExistsInRegistry,
  getNamespacesFromRegistry,
  getPackagesInNamespace,
  getVersionsInNamespace,
  removeNamespaceFromRegistry,
  getTotalPackageCount,
  findPackageInAllNamespaces,
  findPackagesByScope,
} from "./registry.js";
import type { Registry, VersionEntry } from "../types.js";

const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-registry-test-" + Date.now());

vi.mock("../constants.js", () => ({
  getStorePath: () => TEST_STORE_PATH,
  getRegistryPath: () => path.join(TEST_STORE_PATH, "registry.json"),
  REGISTRY_VERSION: "1.0.0",
  DEFAULT_NAMESPACE: "global",
}));

describe("Registry", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
  });

  describe("createEmptyRegistry", () => {
    it("should create registry with global namespace", () => {
      const registry = createEmptyRegistry();
      
      expect(registry.version).toBe("1.0.0");
      expect(registry.namespaces.global).toBeDefined();
      expect(registry.namespaces.global.packages).toEqual({});
    });
  });

  describe("readRegistry / writeRegistry", () => {
    it("should return empty registry when file doesn't exist", async () => {
      const registry = await readRegistry();
      
      expect(registry.version).toBe("1.0.0");
      expect(registry.namespaces.global).toBeDefined();
    });

    it("should write and read registry", async () => {
      const registry = createEmptyRegistry();
      registry.namespaces["test-ns"] = {
        created: "2026-02-12T10:00:00Z",
        packages: {},
      };

      await writeRegistry(registry);
      const read = await readRegistry();

      expect(read.namespaces["test-ns"]).toBeDefined();
    });

    it("should ensure global namespace exists on read", async () => {
      // Write registry without global
      const registryPath = path.join(TEST_STORE_PATH, "registry.json");
      await fs.writeFile(registryPath, JSON.stringify({
        version: "1.0.0",
        namespaces: {
          "other-ns": { created: "2026-02-12T10:00:00Z", packages: {} }
        }
      }));

      const read = await readRegistry();
      expect(read.namespaces.global).toBeDefined();
    });
  });

  describe("ensureNamespaceInRegistry", () => {
    it("should create namespace if not exists", () => {
      const registry = createEmptyRegistry();
      
      ensureNamespaceInRegistry(registry, "new-ns");
      
      expect(registry.namespaces["new-ns"]).toBeDefined();
      expect(registry.namespaces["new-ns"].packages).toEqual({});
    });

    it("should not overwrite existing namespace", () => {
      const registry = createEmptyRegistry();
      registry.namespaces["existing"] = {
        created: "2026-01-01T00:00:00Z",
        packages: { "pkg": { versions: {} } },
      };

      ensureNamespaceInRegistry(registry, "existing");

      expect(registry.namespaces["existing"].created).toBe("2026-01-01T00:00:00Z");
      expect(registry.namespaces["existing"].packages.pkg).toBeDefined();
    });
  });

  describe("addPackageToRegistry", () => {
    it("should add package to existing namespace", () => {
      const registry = createEmptyRegistry();
      const entry: VersionEntry = {
        signature: "abc123",
        published: "2026-02-12T10:00:00Z",
        files: 10,
      };

      addPackageToRegistry(registry, "global", "@scope/pkg", "1.0.0", entry);

      expect(registry.namespaces.global.packages["@scope/pkg"]).toBeDefined();
      expect(registry.namespaces.global.packages["@scope/pkg"].versions["1.0.0"]).toEqual(entry);
    });

    it("should create namespace if not exists", () => {
      const registry = createEmptyRegistry();
      const entry: VersionEntry = {
        signature: "abc123",
        published: "2026-02-12T10:00:00Z",
        files: 10,
      };

      addPackageToRegistry(registry, "new-ns", "pkg", "1.0.0", entry);

      expect(registry.namespaces["new-ns"]).toBeDefined();
      expect(registry.namespaces["new-ns"].packages.pkg.versions["1.0.0"]).toEqual(entry);
    });

    it("should add multiple versions", () => {
      const registry = createEmptyRegistry();
      
      addPackageToRegistry(registry, "global", "pkg", "1.0.0", {
        signature: "v1",
        published: "2026-02-12T10:00:00Z",
        files: 10,
      });
      addPackageToRegistry(registry, "global", "pkg", "2.0.0", {
        signature: "v2",
        published: "2026-02-12T11:00:00Z",
        files: 12,
      });

      expect(Object.keys(registry.namespaces.global.packages.pkg.versions)).toHaveLength(2);
    });
  });

  describe("removePackageFromRegistry", () => {
    it("should remove specific version", () => {
      const registry = createEmptyRegistry();
      addPackageToRegistry(registry, "global", "pkg", "1.0.0", {
        signature: "v1", published: "2026-02-12T10:00:00Z", files: 10,
      });
      addPackageToRegistry(registry, "global", "pkg", "2.0.0", {
        signature: "v2", published: "2026-02-12T11:00:00Z", files: 12,
      });

      const removed = removePackageFromRegistry(registry, "global", "pkg", "1.0.0");

      expect(removed).toBe(true);
      expect(registry.namespaces.global.packages.pkg.versions["1.0.0"]).toBeUndefined();
      expect(registry.namespaces.global.packages.pkg.versions["2.0.0"]).toBeDefined();
    });

    it("should remove entire package when no version specified", () => {
      const registry = createEmptyRegistry();
      addPackageToRegistry(registry, "global", "pkg", "1.0.0", {
        signature: "v1", published: "2026-02-12T10:00:00Z", files: 10,
      });

      const removed = removePackageFromRegistry(registry, "global", "pkg");

      expect(removed).toBe(true);
      expect(registry.namespaces.global.packages.pkg).toBeUndefined();
    });

    it("should clean up empty package entry", () => {
      const registry = createEmptyRegistry();
      addPackageToRegistry(registry, "global", "pkg", "1.0.0", {
        signature: "v1", published: "2026-02-12T10:00:00Z", files: 10,
      });

      removePackageFromRegistry(registry, "global", "pkg", "1.0.0");

      expect(registry.namespaces.global.packages.pkg).toBeUndefined();
    });

    it("should return false for non-existent namespace", () => {
      const registry = createEmptyRegistry();
      const removed = removePackageFromRegistry(registry, "nonexistent", "pkg");
      expect(removed).toBe(false);
    });

    it("should return false for non-existent package", () => {
      const registry = createEmptyRegistry();
      const removed = removePackageFromRegistry(registry, "global", "nonexistent");
      expect(removed).toBe(false);
    });
  });

  describe("getPackageFromRegistry / getVersionFromRegistry", () => {
    it("should get package entry", () => {
      const registry = createEmptyRegistry();
      addPackageToRegistry(registry, "global", "pkg", "1.0.0", {
        signature: "v1", published: "2026-02-12T10:00:00Z", files: 10,
      });

      const pkg = getPackageFromRegistry(registry, "global", "pkg");
      expect(pkg).toBeDefined();
      expect(pkg?.versions["1.0.0"]).toBeDefined();
    });

    it("should return null for non-existent package", () => {
      const registry = createEmptyRegistry();
      const pkg = getPackageFromRegistry(registry, "global", "nonexistent");
      expect(pkg).toBeNull();
    });

    it("should get version entry", () => {
      const registry = createEmptyRegistry();
      addPackageToRegistry(registry, "global", "pkg", "1.0.0", {
        signature: "v1", published: "2026-02-12T10:00:00Z", files: 10,
      });

      const version = getVersionFromRegistry(registry, "global", "pkg", "1.0.0");
      expect(version?.signature).toBe("v1");
    });

    it("should return null for non-existent version", () => {
      const registry = createEmptyRegistry();
      addPackageToRegistry(registry, "global", "pkg", "1.0.0", {
        signature: "v1", published: "2026-02-12T10:00:00Z", files: 10,
      });

      const version = getVersionFromRegistry(registry, "global", "pkg", "2.0.0");
      expect(version).toBeNull();
    });
  });

  describe("getNamespacesFromRegistry", () => {
    it("should return global first", () => {
      const registry = createEmptyRegistry();
      registry.namespaces["aaa"] = { created: "2026-02-12T10:00:00Z", packages: {} };
      registry.namespaces["zzz"] = { created: "2026-02-12T10:00:00Z", packages: {} };

      const namespaces = getNamespacesFromRegistry(registry);

      expect(namespaces[0]).toBe("global");
      expect(namespaces).toContain("aaa");
      expect(namespaces).toContain("zzz");
    });

    it("should sort alphabetically after global", () => {
      const registry = createEmptyRegistry();
      registry.namespaces["beta"] = { created: "2026-02-12T10:00:00Z", packages: {} };
      registry.namespaces["alpha"] = { created: "2026-02-12T10:00:00Z", packages: {} };

      const namespaces = getNamespacesFromRegistry(registry);

      expect(namespaces).toEqual(["global", "alpha", "beta"]);
    });
  });

  describe("removeNamespaceFromRegistry", () => {
    it("should remove namespace", () => {
      const registry = createEmptyRegistry();
      registry.namespaces["test-ns"] = { created: "2026-02-12T10:00:00Z", packages: {} };

      const removed = removeNamespaceFromRegistry(registry, "test-ns");

      expect(removed).toBe(true);
      expect(registry.namespaces["test-ns"]).toBeUndefined();
    });

    it("should throw when trying to remove global", () => {
      const registry = createEmptyRegistry();

      expect(() => removeNamespaceFromRegistry(registry, "global"))
        .toThrow("Cannot delete reserved namespace 'global'");
    });

    it("should return false for non-existent namespace", () => {
      const registry = createEmptyRegistry();
      const removed = removeNamespaceFromRegistry(registry, "nonexistent");
      expect(removed).toBe(false);
    });
  });

  describe("getTotalPackageCount", () => {
    it("should count all versions across namespaces", () => {
      const registry = createEmptyRegistry();
      addPackageToRegistry(registry, "global", "pkg1", "1.0.0", {
        signature: "v1", published: "2026-02-12T10:00:00Z", files: 10,
      });
      addPackageToRegistry(registry, "global", "pkg1", "2.0.0", {
        signature: "v2", published: "2026-02-12T11:00:00Z", files: 12,
      });
      registry.namespaces["other"] = { created: "2026-02-12T10:00:00Z", packages: {} };
      addPackageToRegistry(registry, "other", "pkg2", "1.0.0", {
        signature: "v3", published: "2026-02-12T12:00:00Z", files: 8,
      });

      const count = getTotalPackageCount(registry);
      expect(count).toBe(3);
    });
  });

  describe("findPackageInAllNamespaces", () => {
    it("should find package across namespaces", () => {
      const registry = createEmptyRegistry();
      addPackageToRegistry(registry, "global", "pkg", "1.0.0", {
        signature: "v1", published: "2026-02-12T10:00:00Z", files: 10,
      });
      registry.namespaces["other"] = { created: "2026-02-12T10:00:00Z", packages: {} };
      addPackageToRegistry(registry, "other", "pkg", "2.0.0", {
        signature: "v2", published: "2026-02-12T11:00:00Z", files: 12,
      });

      const results = findPackageInAllNamespaces(registry, "pkg");

      expect(results).toHaveLength(2);
      expect(results[0].namespace).toBe("global"); // global first
      expect(results[0].versions).toContain("1.0.0");
      expect(results[1].namespace).toBe("other");
      expect(results[1].versions).toContain("2.0.0");
    });
  });

  describe("findPackagesByScope", () => {
    it("should find packages by scope", () => {
      const registry = createEmptyRegistry();
      addPackageToRegistry(registry, "global", "@webforgeai/core", "1.0.0", {
        signature: "v1", published: "2026-02-12T10:00:00Z", files: 10,
      });
      addPackageToRegistry(registry, "global", "@webforgeai/utils", "1.0.0", {
        signature: "v2", published: "2026-02-12T11:00:00Z", files: 8,
      });
      addPackageToRegistry(registry, "global", "@other/pkg", "1.0.0", {
        signature: "v3", published: "2026-02-12T12:00:00Z", files: 5,
      });

      const results = findPackagesByScope(registry, "@webforgeai");

      expect(results).toHaveLength(2);
      expect(results.map(r => r.package)).toContain("@webforgeai/core");
      expect(results.map(r => r.package)).toContain("@webforgeai/utils");
    });
  });
});
