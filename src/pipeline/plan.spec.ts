/**
 * Plan Resolver Tests — Validates the plan resolution logic.
 *
 * Tests cover:
 * - Bucket exclusivity (each package in exactly one bucket)
 * - Resolution priority by manager (store-first vs npm-first)
 * - Link packages bypass resolution
 * - Package filter restricts output
 * - Mode resolution (V2 modes object and legacy)
 * - Universal version handling (no mode case)
 * - Remove bucket for packages without version for current mode
 * - Skipped bucket for unresolvable packages
 *
 * Since executePlan loads config from the filesystem via dynamic import(),
 * these tests use the exported `executePlanWithDeps` function which accepts
 * injected dependencies for testability.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Registry } from "../types.js";
import type { PlanOutput } from "./types.js";
import { executePlanWithDeps, type PlanDeps } from "./plan.js";

/**
 * Creates a test registry with packages in the specified namespace.
 */
function createTestRegistry(
  packages: Record<string, Record<string, { signature: string; published: string; files: number }>>,
  namespace = "global"
): Registry {
  return {
    version: "1.0.0",
    namespaces: {
      [namespace]: {
        created: "2024-01-01T00:00:00.000Z",
        packages: Object.fromEntries(
          Object.entries(packages).map(([name, versions]) => [
            name,
            { versions },
          ])
        ),
      },
    },
  };
}

/**
 * Creates mock PlanDeps with sensible defaults for testing.
 */
function createMockDeps(overrides: Partial<PlanDeps> = {}): PlanDeps {
  return {
    loadConfig: async () => ({ packages: {} }),
    readRegistry: async () => createTestRegistry({}),
    checkNpmExists: async () => false,
    ...overrides,
  };
}

describe("executePlanWithDeps", () => {
  describe("package classification with store manager", () => {
    it("classifies a package found in store into the store bucket", async () => {
      const registry = createTestRegistry({
        "@webforgeai/sdk.core": {
          "1.0.0": { signature: "abc123", published: "2024-01-01", files: 10 },
        },
      });

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "@webforgeai/sdk.core": { version: { dev: "1.0.0" } },
          },
          dev: () => ({ manager: "store" as const }),
        }),
        readRegistry: async () => registry,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.store).toHaveLength(1);
      expect(result.packages.store[0].name).toBe("@webforgeai/sdk.core");
      expect(result.packages.store[0].version).toBe("1.0.0");
      expect(result.packages.store[0].namespace).toBe("global");
      expect(result.packages.registry).toHaveLength(0);
      expect(result.packages.skipped).toHaveLength(0);
    });

    it("falls back to npm when package not found in store", async () => {
      const registry = createTestRegistry({});

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "lodash": { version: { dev: "4.17.21" } },
          },
          dev: () => ({ manager: "store" as const }),
        }),
        readRegistry: async () => registry,
        checkNpmExists: async () => true,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.store).toHaveLength(0);
      expect(result.packages.registry).toHaveLength(1);
      expect(result.packages.registry[0].name).toBe("lodash");
      expect(result.packages.registry[0].version).toBe("4.17.21");
    });

    it("classifies as skipped when not found in store or npm", async () => {
      const registry = createTestRegistry({});

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "nonexistent-pkg": { version: { dev: "1.0.0" } },
          },
          dev: () => ({ manager: "store" as const }),
        }),
        readRegistry: async () => registry,
        checkNpmExists: async () => false,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.store).toHaveLength(0);
      expect(result.packages.registry).toHaveLength(0);
      expect(result.packages.skipped).toHaveLength(1);
      expect(result.packages.skipped[0].name).toBe("nonexistent-pkg");
      expect(result.packages.skipped[0].reason).toContain("not found");
    });
  });

  describe("package classification with npm manager", () => {
    it("classifies a package found in npm into the registry bucket", async () => {
      const registry = createTestRegistry({
        "lodash": {
          "4.17.21": { signature: "xyz", published: "2024-01-01", files: 5 },
        },
      });

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "lodash": { version: { dev: "4.17.21" } },
          },
          dev: () => ({ manager: "npm" as const }),
        }),
        readRegistry: async () => registry,
        checkNpmExists: async () => true,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.registry).toHaveLength(1);
      expect(result.packages.registry[0].name).toBe("lodash");
      // Even though it's in the store too, npm-first means it goes to registry
      expect(result.packages.store).toHaveLength(0);
    });

    it("falls back to store when package not found in npm", async () => {
      const registry = createTestRegistry({
        "@webforgeai/sdk.core": {
          "1.0.0": { signature: "abc123", published: "2024-01-01", files: 10 },
        },
      });

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "@webforgeai/sdk.core": { version: { dev: "1.0.0" } },
          },
          dev: () => ({ manager: "npm" as const }),
        }),
        readRegistry: async () => registry,
        checkNpmExists: async () => false,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.registry).toHaveLength(0);
      expect(result.packages.store).toHaveLength(1);
      expect(result.packages.store[0].name).toBe("@webforgeai/sdk.core");
    });

    it("classifies as skipped when not found in npm or store", async () => {
      const registry = createTestRegistry({});

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "ghost-pkg": { version: { dev: "1.0.0" } },
          },
          dev: () => ({ manager: "npm" as const }),
        }),
        readRegistry: async () => registry,
        checkNpmExists: async () => false,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.skipped).toHaveLength(1);
      expect(result.packages.skipped[0].name).toBe("ghost-pkg");
      expect(result.packages.skipped[0].reason).toContain("not found in npm or store");
    });
  });

  describe("link packages", () => {
    it("classifies link packages into the link bucket regardless of manager", async () => {
      const registry = createTestRegistry({});

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "@webforgeai/sdk.core": {
              version: { dev: "1.0.0" },
              link: "../sdk/packages/core",
            },
          },
          dev: () => ({ manager: "store" as const }),
        }),
        readRegistry: async () => registry,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.link).toHaveLength(1);
      expect(result.packages.link[0].name).toBe("@webforgeai/sdk.core");
      expect(result.packages.link[0].path).toBe("../sdk/packages/core");
      expect(result.packages.store).toHaveLength(0);
      expect(result.packages.registry).toHaveLength(0);
    });

    it("preserves dev flag on link packages", async () => {
      const registry = createTestRegistry({});

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "my-dev-tool": {
              version: { dev: "2.0.0" },
              link: "/absolute/path/to/tool",
              dev: true,
            },
          },
          dev: () => ({ manager: "store" as const }),
        }),
        readRegistry: async () => registry,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.link).toHaveLength(1);
      expect(result.packages.link[0].dev).toBe(true);
    });

    it("link packages bypass resolution even with npm manager", async () => {
      const registry = createTestRegistry({});

      const checkNpmExists = vi.fn().mockResolvedValue(true);
      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "local-pkg": {
              version: { dev: "1.0.0" },
              link: "./packages/local",
            },
          },
          dev: () => ({ manager: "npm" as const }),
        }),
        readRegistry: async () => registry,
        checkNpmExists,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.link).toHaveLength(1);
      // checkNpmExists should NOT have been called for link packages
      expect(checkNpmExists).not.toHaveBeenCalled();
    });
  });

  describe("remove bucket", () => {
    it("classifies packages with no version for current mode into remove", async () => {
      const registry = createTestRegistry({});

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "@webforgeai/sdk.core": {
              version: { remote: "1.0.0" }, // No "dev" version
            },
          },
          dev: () => ({ manager: "store" as const }),
          remote: () => ({ manager: "npm" as const }),
        }),
        readRegistry: async () => registry,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.remove).toHaveLength(1);
      expect(result.packages.remove[0]).toBe("@webforgeai/sdk.core");
      expect(result.packages.store).toHaveLength(0);
      expect(result.packages.registry).toHaveLength(0);
    });
  });

  describe("package filter", () => {
    it("only processes packages matching the filter", async () => {
      const registry = createTestRegistry({
        "@webforgeai/sdk.core": {
          "1.0.0": { signature: "abc", published: "2024-01-01", files: 10 },
        },
        "@webforgeai/sdk.http": {
          "1.0.0": { signature: "def", published: "2024-01-01", files: 5 },
        },
      });

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "@webforgeai/sdk.core": { version: { dev: "1.0.0" } },
            "@webforgeai/sdk.http": { version: { dev: "1.0.0" } },
          },
          dev: () => ({ manager: "store" as const }),
        }),
        readRegistry: async () => registry,
      });

      const result = await executePlanWithDeps(
        { mode: "dev", packages: ["@webforgeai/sdk.core"] },
        deps
      );

      // Only the filtered package should appear
      expect(result.packages.store).toHaveLength(1);
      expect(result.packages.store[0].name).toBe("@webforgeai/sdk.core");
    });

    it("throws when filtered package does not exist in config", async () => {
      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "@webforgeai/sdk.core": { version: { dev: "1.0.0" } },
          },
          dev: () => ({ manager: "store" as const }),
        }),
      });

      await expect(
        executePlanWithDeps({ mode: "dev", packages: ["nonexistent"] }, deps)
      ).rejects.toThrow(/not defined in the configuration/);
    });
  });

  describe("universal version (string)", () => {
    it("resolves universal version for any mode", async () => {
      const registry = createTestRegistry({
        "shared-lib": {
          "2.0.0": { signature: "sig", published: "2024-01-01", files: 3 },
        },
      });

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "shared-lib": { version: "2.0.0" }, // Universal string version
          },
          dev: () => ({ manager: "store" as const }),
        }),
        readRegistry: async () => registry,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.store).toHaveLength(1);
      expect(result.packages.store[0].name).toBe("shared-lib");
      expect(result.packages.store[0].version).toBe("2.0.0");
    });
  });

  describe("no mode case (universal packages)", () => {
    it("resolves universal packages without a mode using npm-first strategy", async () => {
      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "universal-pkg": { version: "3.0.0" },
          },
          // No mode factories, no modes object
        }),
        checkNpmExists: async () => true,
      });

      const result = await executePlanWithDeps({}, deps);

      expect(result.mode).toBe("");
      expect(result.manager).toBe("npm");
      expect(result.packages.registry).toHaveLength(1);
      expect(result.packages.registry[0].name).toBe("universal-pkg");
    });

    it("falls back to store for universal packages not in npm", async () => {
      const registry = createTestRegistry({
        "store-only-pkg": {
          "1.0.0": { signature: "abc", published: "2024-01-01", files: 5 },
        },
      });

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "store-only-pkg": { version: "1.0.0" },
          },
        }),
        readRegistry: async () => registry,
        checkNpmExists: async () => false,
      });

      const result = await executePlanWithDeps({}, deps);

      expect(result.packages.store).toHaveLength(1);
      expect(result.packages.store[0].name).toBe("store-only-pkg");
    });
  });

  describe("V2 modes object", () => {
    it("resolves mode from modes.default when no explicit mode provided", async () => {
      const registry = createTestRegistry({
        "my-pkg": {
          "1.0.0": { signature: "abc", published: "2024-01-01", files: 5 },
        },
      });

      const deps = createMockDeps({
        loadConfig: async () => ({
          modes: {
            default: "dev",
            dev: () => ({ manager: "store" as const }),
            remote: () => ({ manager: "npm" as const }),
          },
          packages: {
            "my-pkg": { version: { dev: "1.0.0" } },
          },
        }),
        readRegistry: async () => registry,
      });

      const result = await executePlanWithDeps({}, deps);

      expect(result.mode).toBe("dev");
      expect(result.manager).toBe("store");
      expect(result.packages.store).toHaveLength(1);
    });

    it("uses explicit mode over modes.default", async () => {
      const deps = createMockDeps({
        loadConfig: async () => ({
          modes: {
            default: "dev",
            dev: () => ({ manager: "store" as const }),
            remote: () => ({ manager: "npm" as const }),
          },
          packages: {
            "my-pkg": { version: { dev: "1.0.0", remote: "1.0.0" } },
          },
        }),
        checkNpmExists: async () => true,
      });

      const result = await executePlanWithDeps({ mode: "remote" }, deps);

      expect(result.mode).toBe("remote");
      expect(result.manager).toBe("npm");
    });
  });

  describe("output structure", () => {
    it("includes version, mode, manager, namespaces, and projectPath", async () => {
      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "my-pkg": { version: { dev: "1.0.0" }, link: "./local" },
          },
          dev: () => ({ manager: "store" as const, namespaces: ["global", "team"] }),
        }),
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.version).toBe("1");
      expect(result.mode).toBe("dev");
      expect(result.manager).toBe("store");
      expect(result.namespaces).toEqual(["global", "team"]);
      expect(result.projectPath).toBe(process.cwd());
    });

    it("uses CLI namespaces over mode config namespaces", async () => {
      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "my-pkg": { version: { dev: "1.0.0" }, link: "./local" },
          },
          dev: () => ({ manager: "store" as const, namespaces: ["global", "team"] }),
        }),
      });

      const result = await executePlanWithDeps(
        { mode: "dev", namespaces: ["custom-ns"] },
        deps
      );

      expect(result.namespaces).toEqual(["custom-ns"]);
    });

    it("defaults namespaces to [global] when mode config has none", async () => {
      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "my-pkg": { version: { dev: "1.0.0" }, link: "./local" },
          },
          dev: () => ({ manager: "store" as const }),
        }),
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.namespaces).toEqual(["global"]);
    });
  });

  describe("bucket exclusivity", () => {
    it("each package appears in exactly one bucket", async () => {
      const registry = createTestRegistry({
        "store-pkg": {
          "1.0.0": { signature: "s1", published: "2024-01-01", files: 5 },
        },
      });

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "store-pkg": { version: { dev: "1.0.0" } },
            "npm-pkg": { version: { dev: "2.0.0" } },
            "link-pkg": { version: { dev: "3.0.0" }, link: "./packages/link" },
            "remove-pkg": { version: { remote: "1.0.0" } },
            "skipped-pkg": { version: { dev: "9.9.9" } },
          },
          dev: () => ({ manager: "store" as const }),
          remote: () => ({ manager: "npm" as const }),
        }),
        readRegistry: async () => registry,
        checkNpmExists: async (name: string) => {
          // npm-pkg exists in npm, skipped-pkg does not
          return name === "npm-pkg";
        },
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      // Collect all package names across all buckets
      const allNames = [
        ...result.packages.store.map((p) => p.name),
        ...result.packages.registry.map((p) => p.name),
        ...result.packages.link.map((p) => p.name),
        ...result.packages.remove,
        ...result.packages.skipped.map((p) => p.name),
      ];

      // Each package appears exactly once
      expect(allNames.sort()).toEqual([
        "link-pkg",
        "npm-pkg",
        "remove-pkg",
        "skipped-pkg",
        "store-pkg",
      ]);

      // No duplicates
      expect(new Set(allNames).size).toBe(allNames.length);

      // Verify correct bucket placement
      expect(result.packages.store[0].name).toBe("store-pkg");
      expect(result.packages.registry[0].name).toBe("npm-pkg");
      expect(result.packages.link[0].name).toBe("link-pkg");
      expect(result.packages.remove).toContain("remove-pkg");
      expect(result.packages.skipped[0].name).toBe("skipped-pkg");
    });
  });

  describe("multiple namespaces", () => {
    it("resolves from the first matching namespace", async () => {
      const registry: Registry = {
        version: "1.0.0",
        namespaces: {
          team: {
            created: "2024-01-01T00:00:00.000Z",
            packages: {
              "shared-pkg": {
                versions: {
                  "1.0.0": { signature: "team-sig", published: "2024-01-01", files: 3 },
                },
              },
            },
          },
          global: {
            created: "2024-01-01T00:00:00.000Z",
            packages: {
              "shared-pkg": {
                versions: {
                  "1.0.0": { signature: "global-sig", published: "2024-01-01", files: 3 },
                },
              },
            },
          },
        },
      };

      const deps = createMockDeps({
        loadConfig: async () => ({
          packages: {
            "shared-pkg": { version: { dev: "1.0.0" } },
          },
          dev: () => ({ manager: "store" as const, namespaces: ["team", "global"] }),
        }),
        readRegistry: async () => registry,
      });

      const result = await executePlanWithDeps({ mode: "dev" }, deps);

      expect(result.packages.store).toHaveLength(1);
      expect(result.packages.store[0].namespace).toBe("team");
    });
  });
});
