/**
 * List Command - Integration tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { listPackages } from "./list.js";
import { writeRegistry, createEmptyRegistry, addPackageToRegistry } from "../core/registry.js";

const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-list-test-" + Date.now());

vi.mock("../constants.js", async () => {
  const actual = await vi.importActual("../constants.js");
  return {
    ...actual,
    getStorePath: () => TEST_STORE_PATH,
    getRegistryPath: () => path.join(TEST_STORE_PATH, "registry.json"),
  };
});

describe("List Command", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });
    
    // Create test registry
    const registry = createEmptyRegistry();
    addPackageToRegistry(registry, "global", "@webforgeai/core", "1.0.0", {
      signature: "abc12345",
      published: "2026-02-12T10:00:00Z",
      files: 10,
    });
    addPackageToRegistry(registry, "global", "@webforgeai/core", "2.0.0", {
      signature: "def67890",
      published: "2026-02-12T11:00:00Z",
      files: 12,
    });
    addPackageToRegistry(registry, "global", "simple-pkg", "1.0.0", {
      signature: "ghi11111",
      published: "2026-02-12T10:00:00Z",
      files: 5,
    });
    addPackageToRegistry(registry, "feature", "@webforgeai/core", "1.0.0-beta", {
      signature: "jkl22222",
      published: "2026-02-12T12:00:00Z",
      files: 11,
    });
    await writeRegistry(registry);
  });

  afterEach(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
  });

  describe("by namespace (default)", () => {
    it("should list all namespaces and packages", async () => {
      const output = await listPackages();
      
      expect(output).toContain("global/");
      expect(output).toContain("feature/");
      expect(output).toContain("@webforgeai/");
      expect(output).toContain("core/");
      expect(output).toContain("simple-pkg/");
    });

    it("should show global first", async () => {
      const output = await listPackages();
      
      const globalIndex = output.indexOf("global/");
      const featureIndex = output.indexOf("feature/");
      expect(globalIndex).toBeLessThan(featureIndex);
    });

    it("should filter by namespace", async () => {
      const output = await listPackages({ namespaces: ["feature"] });
      
      expect(output).toContain("feature/");
      expect(output).not.toContain("global/");
    });

    it("should support flat format", async () => {
      const output = await listPackages({ flat: true });
      
      expect(output).toContain("global");
      expect(output).toContain("@webforgeai/core@1.0.0");
      expect(output).not.toContain("├──");
    });
  });

  describe("by package", () => {
    it("should list by package when packages filter provided", async () => {
      const output = await listPackages({ packages: ["@webforgeai/core"], byPackage: true });
      
      expect(output).toContain("@webforgeai/");
      expect(output).toContain("core/");
      expect(output).not.toContain("simple-pkg");
    });

    it("should filter by scope", async () => {
      const output = await listPackages({ packages: ["@webforgeai"], byPackage: true });
      
      expect(output).toContain("@webforgeai/");
      expect(output).not.toContain("simple-pkg");
    });

    it("should support flat format by package", async () => {
      const output = await listPackages({ packages: ["simple-pkg"], byPackage: true, flat: true });
      
      expect(output).toContain("simple-pkg@1.0.0");
      expect(output).toContain("global");
    });
  });
});
