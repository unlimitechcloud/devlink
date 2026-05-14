/**
 * CLI Maintenance Tests — End-to-end tests for remove, verify, and prune commands.
 *
 * Exercises the compiled CLI binary via subprocess, verifying package removal,
 * orphan detection, and pruning behavior with both dry-run and actual execution.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { execCli } from "./helpers/cli.js";
import { decompressPublisher, createTempStore, cleanupTemp } from "./helpers/fixtures.js";

describe("CLI: Maintenance", { timeout: 30000 }, () => {
  let storePath: string;
  let simpleLibPath: string;
  let tempDirs: string[] = [];

  beforeAll(async () => {
    storePath = await createTempStore();
    const pubDir = await decompressPublisher("simple-lib");
    simpleLibPath = join(pubDir, "simple-lib");
    tempDirs.push(pubDir);
  });

  afterAll(async () => {
    await cleanupTemp(storePath);
    for (const d of tempDirs) await cleanupTemp(d);
  });

  it("publish then remove → list no longer shows it", () => {
    // Publish first
    const pubResult = execCli(["publish", "--json"], { cwd: simpleLibPath, repo: storePath });
    expect(pubResult.exitCode).toBe(0);

    // Verify it's listed
    const listBefore = execCli(["list", "--json"], { repo: storePath });
    expect(listBefore.json.namespaces["global"].packages["@test/simple-lib"]).toBeDefined();

    // Remove it
    const removeResult = execCli(["remove", "@test/simple-lib", "--json"], { repo: storePath });
    expect(removeResult.exitCode).toBe(0);
    expect(removeResult.json.removed).toHaveLength(1);
    expect(removeResult.json.removed[0].name).toBe("@test/simple-lib");

    // Verify it's gone from list
    const listAfter = execCli(["list", "--json"], { repo: storePath });
    expect(listAfter.exitCode).toBe(0);
    const globalNs = listAfter.json.namespaces["global"];
    const hasPkg = globalNs && globalNs.packages && globalNs.packages["@test/simple-lib"];
    expect(hasPkg).toBeFalsy();
  });

  it("verify --json detects orphan on disk", async () => {
    // Publish to create a valid entry
    const pubResult = execCli(["publish", "--json"], { cwd: simpleLibPath, repo: storePath });
    expect(pubResult.exitCode).toBe(0);

    // Create an orphan on disk: a package directory that's NOT in the registry
    const orphanDir = join(storePath, "namespaces", "global", "orphan-pkg", "1.0.0");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, "package.json"), JSON.stringify({ name: "orphan-pkg", version: "1.0.0" }));

    // Verify should detect the orphan on disk
    const verifyResult = execCli(["verify", "--json"], { repo: storePath });
    // verify exits with code 5 when issues are found
    expect(verifyResult.exitCode).toBe(5);
    expect(verifyResult.json.valid).toBe(false);
    const diskOrphans = verifyResult.json.issues.filter((i: any) => i.type === "orphan-disk");
    expect(diskOrphans.length).toBeGreaterThan(0);
    expect(diskOrphans.some((o: any) => o.package === "orphan-pkg")).toBe(true);
  });

  it("prune --dry-run --json lists orphans but files still exist", async () => {
    // The orphan from the previous test should still be there
    // Create a fresh orphan to be sure
    const orphanDir = join(storePath, "namespaces", "global", "dry-run-orphan", "1.0.0");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, "package.json"), JSON.stringify({ name: "dry-run-orphan", version: "1.0.0" }));

    const pruneResult = execCli(["prune", "--dry-run", "--json"], { repo: storePath });
    expect(pruneResult.exitCode).toBe(0);
    expect(pruneResult.json.dryRun).toBe(true);
    expect(pruneResult.json.pruned.length).toBeGreaterThan(0);
    const dryRunOrphan = pruneResult.json.pruned.find((p: any) => p.name === "dry-run-orphan");
    expect(dryRunOrphan).toBeDefined();

    // Verify the file still exists (dry-run doesn't delete)
    const verifyResult = execCli(["verify", "--json"], { repo: storePath });
    const stillOrphan = verifyResult.json.issues.some(
      (i: any) => i.type === "orphan-disk" && i.package === "dry-run-orphan"
    );
    expect(stillOrphan).toBe(true);
  });

  it("prune --json removes orphans", async () => {
    // Ensure orphan exists
    const orphanDir = join(storePath, "namespaces", "global", "prune-target", "1.0.0");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, "package.json"), JSON.stringify({ name: "prune-target", version: "1.0.0" }));

    const pruneResult = execCli(["prune", "--json"], { repo: storePath });
    expect(pruneResult.exitCode).toBe(0);
    expect(pruneResult.json.dryRun).toBe(false);
    const pruned = pruneResult.json.pruned.find((p: any) => p.name === "prune-target");
    expect(pruned).toBeDefined();

    // Verify the orphan is gone
    const verifyResult = execCli(["verify", "--json"], { repo: storePath });
    const stillOrphan = verifyResult.json.issues.some(
      (i: any) => i.type === "orphan-disk" && i.package === "prune-target"
    );
    expect(stillOrphan).toBe(false);
  });

  it("verify --fix --json fixes orphans and reports fixed array", async () => {
    // Create an orphan
    const orphanDir = join(storePath, "namespaces", "global", "fix-target", "1.0.0");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(join(orphanDir, "package.json"), JSON.stringify({ name: "fix-target", version: "1.0.0" }));

    // Verify with --fix should fix the orphan
    const fixResult = execCli(["verify", "--fix", "--json"], { repo: storePath });
    expect(fixResult.exitCode).toBe(0);
    expect(fixResult.json).toHaveProperty("fixed");
    expect(Array.isArray(fixResult.json.fixed)).toBe(true);
    expect(fixResult.json.fixed.length).toBeGreaterThan(0);
    const fixedOrphan = fixResult.json.fixed.find((f: any) => f.package === "fix-target");
    expect(fixedOrphan).toBeDefined();
  });

  it("verify --json on healthy store → valid: true, issues: []", async () => {
    // Start with a clean store
    const cleanStore = await createTempStore();
    tempDirs.push(cleanStore);

    // Publish a package to make it a valid store
    const pubResult = execCli(["publish", "--json"], { cwd: simpleLibPath, repo: cleanStore });
    expect(pubResult.exitCode).toBe(0);

    // Verify should show no issues
    const verifyResult = execCli(["verify", "--json"], { repo: cleanStore });
    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.json.valid).toBe(true);
    expect(verifyResult.json.issues).toHaveLength(0);
  });

  it("remove specific version → list shows only remaining version", async () => {
    // Use a clean store for this test
    const cleanStore = await createTempStore();
    tempDirs.push(cleanStore);

    // Publish v1
    const pubDir1 = await decompressPublisher("simple-lib");
    tempDirs.push(pubDir1);
    execCli(["publish", "--json"], { cwd: join(pubDir1, "simple-lib"), repo: cleanStore });

    // Publish v2
    const pubDir2 = await decompressPublisher("simple-lib-v2");
    tempDirs.push(pubDir2);
    execCli(["publish", "--json"], { cwd: join(pubDir2, "simple-lib-v2"), repo: cleanStore });

    // Verify both versions exist
    const listBefore = execCli(["list", "--json"], { repo: cleanStore });
    const pkgBefore = listBefore.json.namespaces["global"].packages["@test/simple-lib"];
    expect(Object.keys(pkgBefore.versions)).toHaveLength(2);
    expect(pkgBefore.versions["1.0.0"]).toBeDefined();
    expect(pkgBefore.versions["2.0.0"]).toBeDefined();

    // Remove v1 specifically
    const removeResult = execCli(["remove", "@test/simple-lib@1.0.0", "--json"], { repo: cleanStore });
    expect(removeResult.exitCode).toBe(0);

    // List should show only v2
    const listAfter = execCli(["list", "--json"], { repo: cleanStore });
    const pkgAfter = listAfter.json.namespaces["global"].packages["@test/simple-lib"];
    expect(Object.keys(pkgAfter.versions)).toHaveLength(1);
    expect(pkgAfter.versions["2.0.0"]).toBeDefined();
    expect(pkgAfter.versions["1.0.0"]).toBeUndefined();
  });

  it("remove namespace → list no longer shows it", () => {
    // Use a clean store for this test
    // Publish to a custom namespace
    const pubResult = execCli(["publish", "--json", "-n", "temp-ns"], { cwd: simpleLibPath, repo: storePath });
    expect(pubResult.exitCode).toBe(0);

    // Verify it exists
    const listBefore = execCli(["list", "--json", "-n", "temp-ns"], { repo: storePath });
    expect(listBefore.json.namespaces["temp-ns"]).toBeDefined();

    // Remove the namespace
    const removeResult = execCli(["remove", "temp-ns", "--json"], { repo: storePath });
    expect(removeResult.exitCode).toBe(0);

    // Verify it's gone
    const listAfter = execCli(["list", "--json", "-n", "temp-ns"], { repo: storePath });
    expect(listAfter.json.namespaces["temp-ns"]).toBeUndefined();
  });
});
