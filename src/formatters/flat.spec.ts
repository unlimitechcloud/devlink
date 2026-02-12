/**
 * Flat Formatter - Unit tests
 */

import { describe, it, expect, vi } from "vitest";
import {
  formatByNamespaceFlat,
  formatByPackageFlat,
  formatConsumersFlat,
  formatResolutionFlat,
} from "./flat.js";
import type { Registry } from "../types.js";

vi.mock("../constants.js", () => ({
  DEFAULT_NAMESPACE: "global",
}));

const createTestRegistry = (): Registry => ({
  version: "1.0.0",
  namespaces: {
    global: {
      created: "2026-02-12T10:00:00Z",
      packages: {
        "@webforgeai/core": {
          versions: {
            "1.0.0": { signature: "abc12345", published: "2026-02-12T10:00:00Z", files: 10 },
            "2.0.0": { signature: "def67890", published: "2026-02-12T11:00:00Z", files: 12 },
          },
        },
        "simple-pkg": {
          versions: {
            "1.0.0": { signature: "ghi11111", published: "2026-02-12T10:00:00Z", files: 5 },
          },
        },
      },
    },
    feature: {
      created: "2026-02-12T12:00:00Z",
      packages: {
        "@webforgeai/core": {
          versions: {
            "1.0.0-beta": { signature: "jkl22222", published: "2026-02-12T12:00:00Z", files: 11 },
          },
        },
      },
    },
  },
});

describe("Flat Formatter", () => {
  describe("formatByNamespaceFlat", () => {
    it("should format registry by namespace", () => {
      const registry = createTestRegistry();
      const output = formatByNamespaceFlat(registry);
      
      expect(output).toContain("global");
      expect(output).toContain("feature");
      expect(output).toContain("@webforgeai/core@1.0.0");
      expect(output).toContain("@webforgeai/core@2.0.0");
      expect(output).toContain("simple-pkg@1.0.0");
    });

    it("should show global first", () => {
      const registry = createTestRegistry();
      const lines = formatByNamespaceFlat(registry).split("\n");
      
      expect(lines[0]).toContain("global");
    });

    it("should filter by namespace", () => {
      const registry = createTestRegistry();
      const output = formatByNamespaceFlat(registry, ["feature"]);
      
      expect(output).toContain("feature");
      expect(output).not.toContain("global");
    });

    it("should show signature by default", () => {
      const registry = createTestRegistry();
      const output = formatByNamespaceFlat(registry);
      
      expect(output).toContain("(abc12345)");
    });

    it("should hide signature when disabled", () => {
      const registry = createTestRegistry();
      const output = formatByNamespaceFlat(registry, undefined, { showSignature: false });
      
      expect(output).not.toContain("(abc12345)");
    });
  });

  describe("formatByPackageFlat", () => {
    it("should format registry by package", () => {
      const registry = createTestRegistry();
      const output = formatByPackageFlat(registry);
      
      expect(output).toContain("@webforgeai/core@1.0.0");
      expect(output).toContain("@webforgeai/core@2.0.0");
      expect(output).toContain("simple-pkg@1.0.0");
    });

    it("should filter by package", () => {
      const registry = createTestRegistry();
      const output = formatByPackageFlat(registry, ["simple-pkg"]);
      
      expect(output).toContain("simple-pkg@1.0.0");
      expect(output).not.toContain("@webforgeai/core");
    });

    it("should filter by scope", () => {
      const registry = createTestRegistry();
      const output = formatByPackageFlat(registry, ["@webforgeai"]);
      
      expect(output).toContain("@webforgeai/core");
      expect(output).not.toContain("simple-pkg");
    });
  });

  describe("formatConsumersFlat", () => {
    it("should format consumers", () => {
      const consumers = [
        {
          projectPath: "/project/a",
          packages: [
            { name: "@webforgeai/core", version: "1.0.0", namespace: "global" },
          ],
        },
      ];
      
      const output = formatConsumersFlat(consumers);
      
      expect(output).toContain("/project/a");
      expect(output).toContain("@webforgeai/core@1.0.0");
      expect(output).toContain("global");
    });
  });

  describe("formatResolutionFlat", () => {
    it("should format found results", () => {
      const results = [
        { package: "@webforgeai/core", version: "1.0.0", found: true, namespace: "global", signature: "abc12345" },
      ];
      
      const output = formatResolutionFlat(results);
      
      expect(output).toContain("@webforgeai/core@1.0.0");
      expect(output).toContain("global");
      expect(output).toContain("(abc12345)");
    });

    it("should format not found results", () => {
      const results = [
        { package: "missing", version: "1.0.0", found: false },
      ];
      
      const output = formatResolutionFlat(results);
      
      expect(output).toContain("missing@1.0.0");
      expect(output).toContain("NOT_FOUND");
    });
  });
});
