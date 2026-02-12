/**
 * Publish Command - Integration tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { publishPackage } from "./publish.js";
import { readRegistry } from "../core/registry.js";

const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-publish-test-" + Date.now());
const TEST_PROJECT_PATH = path.join(os.tmpdir(), "devlink-publish-project-" + Date.now());

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

describe("Publish Command", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });
    await fs.mkdir(TEST_PROJECT_PATH, { recursive: true });
    
    // Create a test package
    await fs.writeFile(
      path.join(TEST_PROJECT_PATH, "package.json"),
      JSON.stringify({
        name: "@test/my-package",
        version: "1.0.0",
        main: "dist/index.js",
        files: ["dist"],
      })
    );
    
    // Create dist directory with a file
    await fs.mkdir(path.join(TEST_PROJECT_PATH, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(TEST_PROJECT_PATH, "dist", "index.js"),
      "module.exports = {};"
    );
  });

  afterEach(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
    await fs.rm(TEST_PROJECT_PATH, { recursive: true, force: true });
  });

  it("should publish package to global namespace", async () => {
    const result = await publishPackage(TEST_PROJECT_PATH);
    
    expect(result.name).toBe("@test/my-package");
    expect(result.version).toBe("1.0.0");
    expect(result.namespace).toBe("global");
    expect(result.signature).toBeDefined();
    expect(result.files).toBeGreaterThan(0);
  });

  it("should publish package to custom namespace", async () => {
    const result = await publishPackage(TEST_PROJECT_PATH, "feature-branch");
    
    expect(result.namespace).toBe("feature-branch");
  });

  it("should update registry after publish", async () => {
    await publishPackage(TEST_PROJECT_PATH);
    
    const registry = await readRegistry();
    expect(registry.namespaces.global.packages["@test/my-package"]).toBeDefined();
    expect(registry.namespaces.global.packages["@test/my-package"].versions["1.0.0"]).toBeDefined();
  });

  it("should copy files to store", async () => {
    const result = await publishPackage(TEST_PROJECT_PATH);
    
    const packageJsonPath = path.join(result.path, "package.json");
    const indexPath = path.join(result.path, "dist", "index.js");
    
    await expect(fs.access(packageJsonPath)).resolves.not.toThrow();
    await expect(fs.access(indexPath)).resolves.not.toThrow();
  });

  it("should write signature file", async () => {
    const result = await publishPackage(TEST_PROJECT_PATH);
    
    const sigPath = path.join(result.path, "devlink.sig");
    const sig = await fs.readFile(sigPath, "utf-8");
    
    expect(sig.trim()).toBe(result.signature);
  });

  it("should throw if package.json is missing", async () => {
    await fs.rm(path.join(TEST_PROJECT_PATH, "package.json"));
    
    await expect(publishPackage(TEST_PROJECT_PATH)).rejects.toThrow();
  });

  it("should throw if name or version is missing", async () => {
    await fs.writeFile(
      path.join(TEST_PROJECT_PATH, "package.json"),
      JSON.stringify({ name: "@test/pkg" }) // Missing version
    );
    
    await expect(publishPackage(TEST_PROJECT_PATH)).rejects.toThrow(
      "package.json must have name and version fields"
    );
  });

  it("should publish multiple versions", async () => {
    await publishPackage(TEST_PROJECT_PATH);
    
    // Update version
    await fs.writeFile(
      path.join(TEST_PROJECT_PATH, "package.json"),
      JSON.stringify({
        name: "@test/my-package",
        version: "2.0.0",
        files: ["dist"],
      })
    );
    
    await publishPackage(TEST_PROJECT_PATH);
    
    const registry = await readRegistry();
    const versions = Object.keys(registry.namespaces.global.packages["@test/my-package"].versions);
    expect(versions).toContain("1.0.0");
    expect(versions).toContain("2.0.0");
  });
});
