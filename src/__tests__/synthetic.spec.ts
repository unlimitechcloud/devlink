/**
 * Unit Tests - Synthetic Packages
 *
 * Tests that synthetic packages are staged to .devlink/ but NOT injected
 * into package.json as file: dependencies.
 *
 * Staging layout: .devlink/{name}/ (flat, no version subdirectory).
 * Validates: Requirements 4.1–4.3, Property 11
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { stageAndRelink, STAGING_DIR } from "../core/staging.js";
import type { ResolvedPackage } from "../types.js";

describe("Synthetic Packages", () => {
  let tmpDir: string;
  let projectDir: string;
  let storeDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devlink-synthetic-test-"));
    projectDir = path.join(tmpDir, "project");
    storeDir = path.join(tmpDir, "store");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(storeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** Create a fake package in the store (store uses version subdirs) */
  async function createStorePackage(name: string, version: string): Promise<string> {
    const pkgDir = path.join(storeDir, name, version);
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name, version }, null, 2),
    );
    await fs.writeFile(path.join(pkgDir, "index.js"), "module.exports = {};");
    return pkgDir;
  }

  function makeResolved(name: string, version: string, storePath: string): ResolvedPackage {
    return {
      name,
      version,
      qname: `${name}@${version}`,
      namespace: "global",
      path: storePath,
      signature: "abc123",
    };
  }

  // =========================================================================
  // stageAndRelink with syntheticPackages set
  // =========================================================================
  it("stages synthetic packages to .devlink/ (they exist on disk)", async () => {
    const corePath = await createStorePackage("@test/core", "1.0.0");
    const sstPath = await createStorePackage("@test/sst", "1.0.0");

    const syntheticSet = new Set(["@test/sst"]);

    const resolved: ResolvedPackage[] = [
      makeResolved("@test/core", "1.0.0", corePath),
      makeResolved("@test/sst", "1.0.0", sstPath),
    ];

    const result = await stageAndRelink(projectDir, resolved, syntheticSet);

    // Both packages should be staged (copied to .devlink/)
    expect(result.staged).toHaveLength(2);

    // Verify both exist on disk in .devlink/ (flat layout)
    const coreManifest = path.join(projectDir, STAGING_DIR, "@test/core", "package.json");
    const sstManifest = path.join(projectDir, STAGING_DIR, "@test/sst", "package.json");
    await expect(fs.access(coreManifest)).resolves.not.toThrow();
    await expect(fs.access(sstManifest)).resolves.not.toThrow();
  });

  it("synthetic packages are included in staged result for re-linking purposes", async () => {
    const corePath = await createStorePackage("@test/core", "1.0.0");
    const sstPath = await createStorePackage("@test/sst", "1.0.0");

    const syntheticSet = new Set(["@test/sst"]);

    const resolved: ResolvedPackage[] = [
      makeResolved("@test/core", "1.0.0", corePath),
      makeResolved("@test/sst", "1.0.0", sstPath),
    ];

    const result = await stageAndRelink(projectDir, resolved, syntheticSet);

    // stageAndRelink itself stages everything — the filtering happens in install.ts
    // Both should appear in staged
    const stagedNames = result.staged.map((s) => s.name);
    expect(stagedNames).toContain("@test/core");
    expect(stagedNames).toContain("@test/sst");
  });

  it("synthetic packages should NOT be injected as file: deps in package.json", async () => {
    // This test simulates the injectStagedPackages logic from install.ts
    // where syntheticPackages are skipped during injection

    const originalManifest = {
      name: "my-app",
      version: "1.0.0",
      dependencies: { express: "^4.18.0" },
    };
    const pkgJsonPath = path.join(projectDir, "package.json");
    await fs.writeFile(pkgJsonPath, JSON.stringify(originalManifest, null, 2));

    const syntheticPackages = new Set(["@test/sst"]);

    // Flat staging layout (no version subdirectory)
    const stagedPkgs = [
      {
        name: "@test/core",
        version: "1.0.0",
        namespace: "global",
        stagingPath: path.join(projectDir, STAGING_DIR, "@test/core"),
      },
      {
        name: "@test/sst",
        version: "1.0.0",
        namespace: "global",
        stagingPath: path.join(projectDir, STAGING_DIR, "@test/sst"),
      },
    ];

    // Replicate the injection logic from install.ts
    const manifest = JSON.parse(await fs.readFile(pkgJsonPath, "utf-8"));
    manifest.dependencies = manifest.dependencies || {};
    for (const pkg of stagedPkgs) {
      if (syntheticPackages.has(pkg.name)) continue; // Skip synthetic
      const relativePath = path.relative(projectDir, pkg.stagingPath);
      manifest.dependencies[pkg.name] = `file:${relativePath}`;
    }
    await fs.writeFile(pkgJsonPath, JSON.stringify(manifest, null, 2));

    // Verify
    const injected = JSON.parse(await fs.readFile(pkgJsonPath, "utf-8"));

    // Non-synthetic should be injected
    expect(injected.dependencies["@test/core"]).toMatch(/^file:/);

    // Synthetic should NOT be injected
    expect(injected.dependencies["@test/sst"]).toBeUndefined();

    // Original deps preserved
    expect(injected.dependencies["express"]).toBe("^4.18.0");
  });

  it("synthetic packages participate in re-linking of internal deps", async () => {
    // A non-synthetic package depends on a synthetic package
    // The synthetic should still be available for re-linking in staging
    const sstPath = await createStorePackage("@test/sst", "1.0.0");
    const connectorPath = path.join(storeDir, "@test/connector", "1.0.0");
    await fs.mkdir(connectorPath, { recursive: true });
    await fs.writeFile(
      path.join(connectorPath, "package.json"),
      JSON.stringify({
        name: "@test/connector",
        version: "1.0.0",
        dependencies: { "@test/sst": "^1.0.0" },
      }, null, 2),
    );

    const syntheticSet = new Set(["@test/sst"]);

    const resolved: ResolvedPackage[] = [
      makeResolved("@test/sst", "1.0.0", sstPath),
      makeResolved("@test/connector", "1.0.0", connectorPath),
    ];

    const result = await stageAndRelink(projectDir, resolved, syntheticSet);

    // The connector's dependency on @test/sst should be re-linked
    expect(result.relinked).toHaveLength(1);
    expect(result.relinked[0].dep).toBe("@test/sst");
    expect(result.relinked[0].to).toMatch(/^file:/);
  });
});
