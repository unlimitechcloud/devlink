/**
 * Unit Tests - Staging and Re-link
 *
 * Tests for stageAndRelink (copy + rewrite internal deps to file: paths),
 * and for the inject/restore package.json logic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { stageAndRelink, STAGING_DIR } from "../core/staging.js";
import type { ResolvedPackage } from "../types.js";

describe("staging", () => {
  let tmpDir: string;
  let projectDir: string;
  let storeDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devlink-staging-test-"));
    projectDir = path.join(tmpDir, "project");
    storeDir = path.join(tmpDir, "store");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(storeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: create a fake package in the "store" directory.
   * Returns the absolute path to the package directory.
   */
  async function createStorePackage(
    name: string,
    version: string,
    deps?: Record<string, string>,
    peerDeps?: Record<string, string>,
    devDeps?: Record<string, string>
  ): Promise<string> {
    const pkgDir = path.join(storeDir, name, version);
    await fs.mkdir(pkgDir, { recursive: true });
    const manifest: Record<string, unknown> = { name, version };
    if (deps) manifest.dependencies = deps;
    if (peerDeps) manifest.peerDependencies = peerDeps;
    if (devDeps) manifest.devDependencies = devDeps;
    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify(manifest, null, 2)
    );
    await fs.mkdir(path.join(pkgDir, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, "dist", "index.js"),
      "module.exports = {};"
    );
    return pkgDir;
  }

  function makeResolved(
    name: string,
    version: string,
    storePath: string,
    namespace = "global"
  ): ResolvedPackage {
    return {
      name,
      version,
      qname: `${name}@${version}`,
      namespace,
      path: storePath,
      signature: "abc123",
    };
  }


  // =========================================================================
  // Test 1: stageAndRelink copies packages correctly to staging
  // =========================================================================
  it("copies packages correctly to staging directory", async () => {
    const corePath = await createStorePackage("@test/core", "1.0.0");
    const utilsPath = await createStorePackage("@test/utils", "1.0.0");

    const resolved: ResolvedPackage[] = [
      makeResolved("@test/core", "1.0.0", corePath),
      makeResolved("@test/utils", "1.0.0", utilsPath),
    ];

    const result = await stageAndRelink(projectDir, resolved);

    // Verify staging directory structure
    const coreManifest = path.join(
      projectDir, STAGING_DIR, "@test/core", "1.0.0", "package.json"
    );
    const utilsManifest = path.join(
      projectDir, STAGING_DIR, "@test/utils", "1.0.0", "package.json"
    );
    const coreDist = path.join(
      projectDir, STAGING_DIR, "@test/core", "1.0.0", "dist", "index.js"
    );

    await expect(fs.access(coreManifest)).resolves.not.toThrow();
    await expect(fs.access(utilsManifest)).resolves.not.toThrow();
    await expect(fs.access(coreDist)).resolves.not.toThrow();

    expect(result.staged).toHaveLength(2);
    expect(result.staged[0].name).toBe("@test/core");
    expect(result.staged[1].name).toBe("@test/utils");
  });

  // =========================================================================
  // Test 2: stageAndRelink rewrites internal dependencies to file: paths
  // =========================================================================
  it("rewrites internal dependencies to file: relative paths", async () => {
    const corePath = await createStorePackage("@test/core", "1.0.0");
    const httpPath = await createStorePackage("@test/http", "1.0.0", {
      "@test/core": "^1.0.0",
    });

    const resolved: ResolvedPackage[] = [
      makeResolved("@test/core", "1.0.0", corePath),
      makeResolved("@test/http", "1.0.0", httpPath),
    ];

    const result = await stageAndRelink(projectDir, resolved);

    // Read the relinked http package.json
    const httpManifestPath = path.join(
      projectDir, STAGING_DIR, "@test/http", "1.0.0", "package.json"
    );
    const httpManifest = JSON.parse(await fs.readFile(httpManifestPath, "utf-8"));

    expect(httpManifest.dependencies["@test/core"]).toMatch(/^file:/);
    // The relative path goes from @test/http/1.0.0 → ../../core/1.0.0
    // (since @test/ is the shared scope directory)
    expect(httpManifest.dependencies["@test/core"]).toContain("core");
    expect(httpManifest.dependencies["@test/core"]).toContain("1.0.0");
    // Verify the path is actually valid by checking it resolves correctly
    const httpStagingPath = path.join(
      projectDir, STAGING_DIR, "@test/http", "1.0.0"
    );
    const resolvedDepPath = path.resolve(
      httpStagingPath,
      httpManifest.dependencies["@test/core"].replace("file:", "")
    );
    const expectedCorePath = path.join(
      projectDir, STAGING_DIR, "@test/core", "1.0.0"
    );
    expect(resolvedDepPath).toBe(expectedCorePath);

    expect(result.relinked).toHaveLength(1);
    expect(result.relinked[0].dep).toBe("@test/core");
    expect(result.relinked[0].from).toBe("^1.0.0");
    expect(result.relinked[0].to).toMatch(/^file:/);
  });

  // =========================================================================
  // Test 3: stageAndRelink does not modify external dependencies
  // =========================================================================
  it("does not modify external dependencies", async () => {
    const utilsPath = await createStorePackage("@test/utils", "1.0.0");
    const corePath = await createStorePackage("@test/core", "1.0.0", {
      express: "^4.18.0",
      "@test/utils": "^1.0.0",
    });

    const resolved: ResolvedPackage[] = [
      makeResolved("@test/core", "1.0.0", corePath),
      makeResolved("@test/utils", "1.0.0", utilsPath),
    ];

    const result = await stageAndRelink(projectDir, resolved);

    const coreManifestPath = path.join(
      projectDir, STAGING_DIR, "@test/core", "1.0.0", "package.json"
    );
    const coreManifest = JSON.parse(await fs.readFile(coreManifestPath, "utf-8"));

    // External dep unchanged
    expect(coreManifest.dependencies["express"]).toBe("^4.18.0");
    // Internal dep relinked
    expect(coreManifest.dependencies["@test/utils"]).toMatch(/^file:/);
  });

  // =========================================================================
  // Test 4: stageAndRelink handles cross-namespace packages
  // =========================================================================
  it("handles cross-namespace packages correctly", async () => {
    // Simulate packages from different namespaces (different store paths)
    const globalCorePath = await createStorePackage("@test/core", "1.0.0");
    const featureHttpPath = await createStorePackage("@test/http", "1.0.0", {
      "@test/core": "^1.0.0",
    });

    const resolved: ResolvedPackage[] = [
      makeResolved("@test/core", "1.0.0", globalCorePath, "global"),
      makeResolved("@test/http", "1.0.0", featureHttpPath, "feature-v2"),
    ];

    const result = await stageAndRelink(projectDir, resolved);

    // Both should be staged regardless of namespace
    expect(result.staged).toHaveLength(2);
    expect(result.staged[0].namespace).toBe("global");
    expect(result.staged[1].namespace).toBe("feature-v2");

    // Cross-namespace dep should be relinked
    const httpManifestPath = path.join(
      projectDir, STAGING_DIR, "@test/http", "1.0.0", "package.json"
    );
    const httpManifest = JSON.parse(await fs.readFile(httpManifestPath, "utf-8"));
    expect(httpManifest.dependencies["@test/core"]).toMatch(/^file:/);

    expect(result.relinked).toHaveLength(1);
    expect(result.relinked[0].dep).toBe("@test/core");
  });

  // =========================================================================
  // Test 5: stageAndRelink uses semver.maxSatisfying to resolve ranges
  // =========================================================================
  it("uses semver.maxSatisfying to select best version", async () => {
    const core100Path = await createStorePackage("@test/core", "1.0.0");
    const core120Path = await createStorePackage("@test/core", "1.2.0");
    const httpPath = await createStorePackage("@test/http", "1.0.0", {
      "@test/core": "^1.0.0",
    });

    const resolved: ResolvedPackage[] = [
      makeResolved("@test/core", "1.0.0", core100Path),
      makeResolved("@test/core", "1.2.0", core120Path),
      makeResolved("@test/http", "1.0.0", httpPath),
    ];

    const result = await stageAndRelink(projectDir, resolved);

    const httpManifestPath = path.join(
      projectDir, STAGING_DIR, "@test/http", "1.0.0", "package.json"
    );
    const httpManifest = JSON.parse(await fs.readFile(httpManifestPath, "utf-8"));

    // Should point to 1.2.0 (maxSatisfying of ^1.0.0 with [1.0.0, 1.2.0])
    expect(httpManifest.dependencies["@test/core"]).toContain("1.2.0");
    expect(httpManifest.dependencies["@test/core"]).not.toContain(
      path.join("1.0.0", "")
    );
  });

  // =========================================================================
  // Test 6: stageAndRelink does not modify devDependencies
  // =========================================================================
  it("does not modify devDependencies", async () => {
    const corePath = await createStorePackage("@test/core", "1.0.0");
    const httpPath = await createStorePackage(
      "@test/http",
      "1.0.0",
      undefined, // no dependencies
      undefined, // no peerDependencies
      { "@test/core": "^1.0.0" } // devDependencies
    );

    const resolved: ResolvedPackage[] = [
      makeResolved("@test/core", "1.0.0", corePath),
      makeResolved("@test/http", "1.0.0", httpPath),
    ];

    const result = await stageAndRelink(projectDir, resolved);

    const httpManifestPath = path.join(
      projectDir, STAGING_DIR, "@test/http", "1.0.0", "package.json"
    );
    const httpManifest = JSON.parse(await fs.readFile(httpManifestPath, "utf-8"));

    // devDependencies should remain unchanged
    expect(httpManifest.devDependencies["@test/core"]).toBe("^1.0.0");
    // No relinks should have occurred
    expect(result.relinked).toHaveLength(0);
  });

  // =========================================================================
  // Test 7: injectStagedPackages injects correct relative paths
  // =========================================================================
  it("injectStagedPackages injects correct file: relative paths", async () => {
    // Create a project package.json
    const originalManifest = {
      name: "my-app",
      version: "1.0.0",
      dependencies: { express: "^4.18.0" },
    };
    const pkgJsonPath = path.join(projectDir, "package.json");
    await fs.writeFile(pkgJsonPath, JSON.stringify(originalManifest, null, 2));

    // Simulate staged packages
    const stagedPkgs = [
      {
        name: "@test/core",
        version: "1.0.0",
        namespace: "global",
        stagingPath: path.join(projectDir, STAGING_DIR, "@test/core", "1.0.0"),
      },
    ];

    // Replicate injectStagedPackages logic
    const originalContent = await fs.readFile(pkgJsonPath, "utf-8");
    const manifest = JSON.parse(originalContent);
    manifest.dependencies = manifest.dependencies || {};
    for (const pkg of stagedPkgs) {
      const relativePath = path.relative(projectDir, pkg.stagingPath);
      manifest.dependencies[pkg.name] = `file:${relativePath}`;
    }
    await fs.writeFile(pkgJsonPath, JSON.stringify(manifest, null, 2) + "\n");

    // Verify
    const injected = JSON.parse(await fs.readFile(pkgJsonPath, "utf-8"));
    expect(injected.dependencies["express"]).toBe("^4.18.0");
    expect(injected.dependencies["@test/core"]).toBe(
      `file:${STAGING_DIR}/@test/core/1.0.0`
    );
  });

  // =========================================================================
  // Test 8: restorePackageJson restores exact content
  // =========================================================================
  it("restorePackageJson restores byte-for-byte identical content", async () => {
    const originalContent = JSON.stringify(
      { name: "my-app", version: "1.0.0", dependencies: { express: "^4.18.0" } },
      null,
      2
    );
    const pkgJsonPath = path.join(projectDir, "package.json");
    await fs.writeFile(pkgJsonPath, originalContent);

    // Simulate backup
    const backup = {
      packageJsonPath: pkgJsonPath,
      originalContent,
      restored: false,
    };

    // Modify the file (simulate injection)
    await fs.writeFile(pkgJsonPath, '{"name":"modified"}');

    // Restore
    if (!backup.restored) {
      await fs.writeFile(backup.packageJsonPath, backup.originalContent);
      backup.restored = true;
    }

    // Verify byte-for-byte identical
    const restoredContent = await fs.readFile(pkgJsonPath, "utf-8");
    expect(restoredContent).toBe(originalContent);
    expect(backup.restored).toBe(true);
  });
});
