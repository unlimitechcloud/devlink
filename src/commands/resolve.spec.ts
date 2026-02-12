/**
 * Resolve Command - Integration tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { resolvePackagesCommand } from "./resolve.js";
import { writeRegistry, createEmptyRegistry, addPackageToRegistry } from "../core/registry.js";

const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-resolve-test-" + Date.now());

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
  };
});

describe("Resolve Command", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });
    
    const registry = createEmptyRegistry();
    addPackageToRegistry(registry, "global", "@webforgeai/core", "1.0.0", {
      signature: "global-v1",
      published: "2026-02-12T10:00:00Z",
      files: 10,
    });
    addPackageToRegistry(registry, "global", "@webforgeai/core", "2.0.0", {
      signature: "global-v2",
      published: "2026-02-12T11:00:00Z",
      files: 12,
    });
    addPackageToRegistry(registry, "feature", "@webforgeai/core", "1.0.0", {
      signature: "feature-v1",
      published: "2026-02-12T12:00:00Z",
      files: 11,
    });
    await writeRegistry(registry);
  });

  afterEach(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
  });

  it("should resolve package from global namespace", async () => {
    const output = await resolvePackagesCommand(["@webforgeai/core@1.0.0"]);
    
    expect(output).toContain("✓");
    expect(output).toContain("@webforgeai/core@1.0.0");
    expect(output).toContain("global");
  });

  it("should resolve from first matching namespace", async () => {
    const output = await resolvePackagesCommand(
      ["@webforgeai/core@1.0.0"],
      { namespaces: ["feature", "global"] }
    );
    
    expect(output).toContain("feature");
    // Signature is truncated to 8 chars in output
    expect(output).toContain("feature-");
  });

  it("should fall back to later namespaces", async () => {
    const output = await resolvePackagesCommand(
      ["@webforgeai/core@2.0.0"],
      { namespaces: ["feature", "global"] }
    );
    
    expect(output).toContain("global");
    // Signature is truncated to 8 chars in output
    expect(output).toContain("global-v");
  });

  it("should show not found for missing packages", async () => {
    const output = await resolvePackagesCommand(["nonexistent@1.0.0"]);
    
    expect(output).toContain("✗");
    expect(output).toContain("not found");
  });

  it("should resolve multiple packages", async () => {
    const output = await resolvePackagesCommand([
      "@webforgeai/core@1.0.0",
      "@webforgeai/core@2.0.0",
    ]);
    
    expect(output).toContain("@webforgeai/core@1.0.0");
    expect(output).toContain("@webforgeai/core@2.0.0");
  });

  it("should support flat format", async () => {
    const output = await resolvePackagesCommand(
      ["@webforgeai/core@1.0.0"],
      { flat: true }
    );
    
    expect(output).toContain("@webforgeai/core@1.0.0");
    expect(output).toContain("global");
    expect(output).not.toContain("✓");
  });

  it("should throw for invalid specs", async () => {
    await expect(resolvePackagesCommand(["invalid"])).rejects.toThrow(
      "No valid package specifications"
    );
  });
});
