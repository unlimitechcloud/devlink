/**
 * Tree Formatter - Unit tests
 */

import { describe, it, expect, vi } from "vitest";
import { formatByNamespaceTree, formatByPackageTree, formatConsumersTree } from "./tree.js";
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

describe("Tree Formatter", () => {
  describe("formatByNamespaceTree", () => {
    it("should format registry by namespace", () => {
      const registry = createTestRegistry();
      const output = formatByNamespaceTree(registry);
      
      expect(output).toContain("📦 DevLink Store");
      expect(output).toContain("global/");
      expect(output).toContain("feature/");
      expect(output).toContain("@webforgeai/");
      expect(output).toContain("core/");
      expect(output).toContain("1.0.0");
      expect(output).toContain("2.0.0");
    });

    it("should show global first", () => {
      const registry = createTestRegistry();
      const output = formatByNamespaceTree(registry);
      
      const globalIndex = output.indexOf("global/");
      const featureIndex = output.indexOf("feature/");
      expect(globalIndex).toBeLessThan(featureIndex);
    });

    it("should filter by namespace", () => {
      const registry = createTestRegistry();
      const output = formatByNamespaceTree(registry, ["feature"]);
      
      expect(output).toContain("feature/");
      expect(output).not.toContain("global/");
    });

    it("should show signature by default", () => {
      const registry = createTestRegistry();
      const output = formatByNamespaceTree(registry);
      
      expect(output).toContain("(abc12345)");
    });

    it("should hide signature when disabled", () => {
      const registry = createTestRegistry();
      const output = formatByNamespaceTree(registry, undefined, { showSignature: false });
      
      expect(output).not.toContain("(abc12345)");
    });
  });

  describe("formatByPackageTree", () => {
    it("should format registry by package", () => {
      const registry = createTestRegistry();
      const output = formatByPackageTree(registry);
      
      expect(output).toContain("📦 DevLink Store (by package)");
      expect(output).toContain("@webforgeai/");
      expect(output).toContain("core/");
      expect(output).toContain("global/");
      expect(output).toContain("feature/");
    });

    it("should filter by package", () => {
      const registry = createTestRegistry();
      const output = formatByPackageTree(registry, ["simple-pkg"]);
      
      expect(output).toContain("simple-pkg/");
      expect(output).not.toContain("@webforgeai/");
    });

    it("should filter by scope", () => {
      const registry = createTestRegistry();
      const output = formatByPackageTree(registry, ["@webforgeai"]);
      
      expect(output).toContain("@webforgeai/");
      expect(output).not.toContain("simple-pkg");
    });
  });

  describe("formatConsumersTree", () => {
    it("should format consumers", () => {
      const consumers = [
        {
          projectPath: "/project/a",
          packages: [
            { name: "@webforgeai/core", version: "1.0.0", namespace: "global" },
          ],
        },
        {
          projectPath: "/project/b",
          packages: [
            { name: "@webforgeai/core", version: "2.0.0", namespace: "feature" },
            { name: "simple-pkg", version: "1.0.0", namespace: "global" },
          ],
        },
      ];
      
      const output = formatConsumersTree(consumers);
      
      expect(output).toContain("👥 Consumers");
      expect(output).toContain("/project/a");
      expect(output).toContain("/project/b");
      expect(output).toContain("@webforgeai/core@1.0.0");
      expect(output).toContain("(global)");
      expect(output).toContain("(feature)");
    });
  });
});
