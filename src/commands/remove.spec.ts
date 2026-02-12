/**
 * Remove Command - Unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { removeFromStore } from "./remove.js";
import {
  writeRegistry,
  createEmptyRegistry,
  addPackageToRegistry,
  readRegistry,
} from "../core/registry.js";
import { ensureNamespace } from "../core/store.js";

const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-remove-test-" + Date.now());

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
    getLockPath: () => path.join(TEST_STORE_PATH, ".lock"),
  };
});

describe("Remove Command", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });

    const registry = createEmptyRegistry();
    addPackageToRegistry(registry, "global", "@test/pkg", "1.0.0", {
      signature: "abc12345",
      published: "2026-02-12T10:00:00Z",
      files: 5,
    });
    addPackageToRegistry(registry, "global", "@test/pkg", "2.0.0", {
      signature: "def67890",
      published: "2026-02-12T11:00:00Z",
      files: 5,
    });
    addPackageToRegistry(registry, "feature", "@test/pkg", "1.0.0-beta", {
      signature: "ghi11111",
      published: "2026-02-12T12:00:00Z",
      files: 5,
    });
    await writeRegistry(registry);

    await ensureNamespace("global");
    await ensureNamespace("feature");

    const v1Path = path.join(TEST_STORE_PATH, "namespaces/global/@test/pkg/1.0.0");
    const v2Path = path.join(TEST_STORE_PATH, "namespaces/global/@test/pkg/2.0.0");
    const betaPath = path.join(TEST_STORE_PATH, "namespaces/feature/@test/pkg/1.0.0-beta");

    await fs.mkdir(v1Path, { recursive: true });
    await fs.mkdir(v2Path, { recursive: true });
    await fs.mkdir(betaPath, { recursive: true });

    await fs.writeFile(path.join(v1Path, "package.json"), "{}");
    await fs.writeFile(path.join(v2Path, "package.json"), "{}");
    await fs.writeFile(path.join(betaPath, "package.json"), "{}");
  });

  afterEach(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
  });

  it("should remove specific version", async () => {
    const result = await removeFromStore("@test/pkg@1.0.0", { namespace: "global" });

    expect(result.type).toBe("version");
    expect(result.name).toBe("@test/pkg");
    expect(result.version).toBe("1.0.0");

    const registry = await readRegistry();
    expect(registry.namespaces.global.packages["@test/pkg"].versions["1.0.0"]).toBeUndefined();
    expect(registry.namespaces.global.packages["@test/pkg"].versions["2.0.0"]).toBeDefined();
  });

  it("should remove entire package", async () => {
    const result = await removeFromStore("@test/pkg", { namespace: "global" });

    expect(result.type).toBe("package");

    const registry = await readRegistry();
    expect(registry.namespaces.global.packages["@test/pkg"]).toBeUndefined();
  });

  it("should remove namespace", async () => {
    const result = await removeFromStore("feature");

    expect(result.type).toBe("namespace");

    const registry = await readRegistry();
    expect(registry.namespaces.feature).toBeUndefined();
  });

  it("should throw when removing global namespace", async () => {
    await expect(removeFromStore("global")).rejects.toThrow(
      "Cannot delete reserved namespace 'global'"
    );
  });

  it("should throw for non-existent package", async () => {
    await expect(
      removeFromStore("nonexistent@1.0.0", { namespace: "global" })
    ).rejects.toThrow("not found");
  });
});
