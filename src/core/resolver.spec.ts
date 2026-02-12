/**
 * Resolver - Unit tests
 */

import { describe, it, expect, vi } from "vitest";
import {
  resolvePackage,
  resolvePackages,
  findInNamespace,
  packageExistsInNamespaces,
  getAllVersions,
  parsePackageSpec,
  parsePackageSpecs,
  formatResolutionResult,
  formatResolutionResults,
} from "./resolver.js";
import type { Registry } from "../types.js";

vi.mock("../constants.js", () => ({
  getPackagePath: (ns: string, pkg: string, ver: string) => `/store/namespaces/${ns}/${pkg}/${ver}`,
  DEFAULT_NAMESPACE: "global",
}));

const createTestRegistry = (): Registry => ({
  version: "1.0.0",
  namespaces: {
    global: {
      created: "2026-02-12T10:00:00Z",
      packages: {
        "@scope/pkg": {
          versions: {
            "1.0.0": { signature: "global-v1", published: "2026-02-12T10:00:00Z", files: 10 },
            "2.0.0": { signature: "global-v2", published: "2026-02-12T11:00:00Z", files: 12 },
          },
        },
        "simple-pkg": {
          versions: {
            "1.0.0": { signature: "simple-v1", published: "2026-02-12T10:00:00Z", files: 5 },
          },
        },
      },
    },
    feature: {
      created: "2026-02-12T12:00:00Z",
      packages: {
        "@scope/pkg": {
          versions: {
            "1.0.0": { signature: "feature-v1", published: "2026-02-12T12:00:00Z", files: 11 },
          },
        },
      },
    },
  },
});

describe("Resolver", () => {
  describe("resolvePackage", () => {
    it("should resolve package from first matching namespace", () => {
      const registry = createTestRegistry();
      
      const result = resolvePackage("@scope/pkg", "1.0.0", ["feature", "global"], registry);
      
      expect(result.found).toBe(true);
      expect(result.namespace).toBe("feature");
      expect(result.signature).toBe("feature-v1");
    });

    it("should fall back to later namespaces", () => {
      const registry = createTestRegistry();
      
      const result = resolvePackage("@scope/pkg", "2.0.0", ["feature", "global"], registry);
      
      expect(result.found).toBe(true);
      expect(result.namespace).toBe("global");
      expect(result.signature).toBe("global-v2");
    });

    it("should return not found for missing package", () => {
      const registry = createTestRegistry();
      
      const result = resolvePackage("nonexistent", "1.0.0", ["global"], registry);
      
      expect(result.found).toBe(false);
      expect(result.searchedNamespaces).toContain("global");
    });

    it("should use global namespace by default", () => {
      const registry = createTestRegistry();
      
      const result = resolvePackage("simple-pkg", "1.0.0", [], registry);
      
      expect(result.found).toBe(true);
      expect(result.namespace).toBe("global");
    });

    it("should track searched namespaces", () => {
      const registry = createTestRegistry();
      
      const result = resolvePackage("nonexistent", "1.0.0", ["feature", "global"], registry);
      
      expect(result.searchedNamespaces).toEqual(["feature", "global"]);
    });

    it("should include path in result", () => {
      const registry = createTestRegistry();
      
      const result = resolvePackage("@scope/pkg", "1.0.0", ["global"], registry);
      
      expect(result.path).toBe("/store/namespaces/global/@scope/pkg/1.0.0");
    });
  });

  describe("resolvePackages", () => {
    it("should resolve multiple packages", () => {
      const registry = createTestRegistry();
      const packages = [
        { name: "@scope/pkg", version: "1.0.0" },
        { name: "simple-pkg", version: "1.0.0" },
      ];
      
      const results = resolvePackages(packages, ["global"], registry);
      
      expect(results).toHaveLength(2);
      expect(results[0].found).toBe(true);
      expect(results[1].found).toBe(true);
    });
  });

  describe("findInNamespace", () => {
    it("should find package in specific namespace", () => {
      const registry = createTestRegistry();
      
      const result = findInNamespace("@scope/pkg", "1.0.0", "feature", registry);
      
      expect(result.found).toBe(true);
      expect(result.namespace).toBe("feature");
    });

    it("should not find package in wrong namespace", () => {
      const registry = createTestRegistry();
      
      const result = findInNamespace("simple-pkg", "1.0.0", "feature", registry);
      
      expect(result.found).toBe(false);
    });
  });

  describe("packageExistsInNamespaces", () => {
    it("should return true for existing package", () => {
      const registry = createTestRegistry();
      
      const exists = packageExistsInNamespaces("@scope/pkg", "1.0.0", ["global"], registry);
      
      expect(exists).toBe(true);
    });

    it("should return false for non-existent package", () => {
      const registry = createTestRegistry();
      
      const exists = packageExistsInNamespaces("nonexistent", "1.0.0", ["global"], registry);
      
      expect(exists).toBe(false);
    });
  });

  describe("getAllVersions", () => {
    it("should get all versions across namespaces", () => {
      const registry = createTestRegistry();
      
      const versions = getAllVersions("@scope/pkg", ["global", "feature"], registry);
      
      expect(versions).toHaveLength(3);
      expect(versions.map(v => v.version)).toContain("1.0.0");
      expect(versions.map(v => v.version)).toContain("2.0.0");
    });

    it("should search all namespaces when none specified", () => {
      const registry = createTestRegistry();
      
      const versions = getAllVersions("@scope/pkg", [], registry);
      
      expect(versions.length).toBeGreaterThan(0);
    });
  });

  describe("parsePackageSpec", () => {
    it("should parse scoped package", () => {
      const result = parsePackageSpec("@scope/pkg@1.0.0");
      
      expect(result).toEqual({ name: "@scope/pkg", version: "1.0.0" });
    });

    it("should parse simple package", () => {
      const result = parsePackageSpec("pkg@1.0.0");
      
      expect(result).toEqual({ name: "pkg", version: "1.0.0" });
    });

    it("should return null for invalid spec", () => {
      const result = parsePackageSpec("invalid");
      
      expect(result).toBeNull();
    });

    it("should handle complex versions", () => {
      const result = parsePackageSpec("@scope/pkg@1.0.0-beta.1");
      
      expect(result).toEqual({ name: "@scope/pkg", version: "1.0.0-beta.1" });
    });
  });

  describe("parsePackageSpecs", () => {
    it("should parse multiple specs", () => {
      const results = parsePackageSpecs(["@scope/pkg@1.0.0", "other@2.0.0"]);
      
      expect(results).toHaveLength(2);
    });

    it("should skip invalid specs", () => {
      const results = parsePackageSpecs(["@scope/pkg@1.0.0", "invalid", "other@2.0.0"]);
      
      expect(results).toHaveLength(2);
    });
  });

  describe("formatResolutionResult", () => {
    it("should format found result", () => {
      const result = {
        package: "@scope/pkg",
        version: "1.0.0",
        found: true,
        namespace: "global",
        signature: "abc12345678",
        searchedNamespaces: ["global"],
      };
      
      const formatted = formatResolutionResult(result);
      
      expect(formatted).toContain("✓");
      expect(formatted).toContain("@scope/pkg@1.0.0");
      expect(formatted).toContain("global");
      expect(formatted).toContain("abc12345");
    });

    it("should format not found result", () => {
      const result = {
        package: "@scope/pkg",
        version: "1.0.0",
        found: false,
        searchedNamespaces: ["feature", "global"],
      };
      
      const formatted = formatResolutionResult(result);
      
      expect(formatted).toContain("✗");
      expect(formatted).toContain("not found");
      expect(formatted).toContain("feature, global");
    });
  });

  describe("formatResolutionResults", () => {
    it("should format multiple results", () => {
      const results = [
        { package: "pkg1", version: "1.0.0", found: true, namespace: "global", signature: "abc", searchedNamespaces: ["global"] },
        { package: "pkg2", version: "1.0.0", found: false, searchedNamespaces: ["global"] },
      ];
      
      const formatted = formatResolutionResults(results);
      
      expect(formatted).toContain("pkg1");
      expect(formatted).toContain("pkg2");
      expect(formatted.split("\n")).toHaveLength(2);
    });
  });
});
