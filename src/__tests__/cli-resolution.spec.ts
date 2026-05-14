/**
 * CLI Resolution Tests — End-to-end tests for resolve and consumers commands.
 *
 * Exercises the compiled CLI binary via subprocess, verifying package resolution
 * across namespaces with precedence rules, and consumer tracking.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { execCli } from "./helpers/cli.js";
import { decompressPublisher, createTempStore, cleanupTemp } from "./helpers/fixtures.js";

describe("CLI: Resolution", { timeout: 30000 }, () => {
  let storePath: string;
  let simpleLibPath: string;
  let simpleLibV2Path: string;
  let tempDirs: string[] = [];

  beforeAll(async () => {
    storePath = await createTempStore();
    const pubDir = await decompressPublisher("simple-lib");
    simpleLibPath = join(pubDir, "simple-lib");
    tempDirs.push(pubDir);
    const pubDir2 = await decompressPublisher("simple-lib-v2");
    simpleLibV2Path = join(pubDir2, "simple-lib-v2");
    tempDirs.push(pubDir2);

    // Pre-populate store: publish v1 to global, v2 to feature namespace
    execCli(["publish", "--json", "-n", "global"], { cwd: simpleLibPath, repo: storePath });
    execCli(["publish", "--json", "-n", "feature"], { cwd: simpleLibV2Path, repo: storePath });
  });

  afterAll(async () => {
    await cleanupTemp(storePath);
    for (const d of tempDirs) await cleanupTemp(d);
  });

  it("resolve with namespace precedence selects correct namespace", () => {
    // Resolve @test/simple-lib@1.0.0 with precedence: feature,global
    // feature has v2.0.0, global has v1.0.0 — so v1.0.0 should resolve from global
    const result = execCli(
      ["resolve", "@test/simple-lib@1.0.0", "-n", "feature,global", "--json"],
      { repo: storePath }
    );
    expect(result.exitCode).toBe(0);
    expect(result.json.results).toHaveLength(1);
    expect(result.json.results[0].resolved).toBe(true);
    expect(result.json.results[0].namespace).toBe("global");

    // Resolve @test/simple-lib@2.0.0 with precedence: feature,global
    // feature has v2.0.0 — should resolve from feature
    const result2 = execCli(
      ["resolve", "@test/simple-lib@2.0.0", "-n", "feature,global", "--json"],
      { repo: storePath }
    );
    expect(result2.exitCode).toBe(0);
    expect(result2.json.results[0].resolved).toBe(true);
    expect(result2.json.results[0].namespace).toBe("feature");
  });

  it("resolve non-existent package returns resolved: false", () => {
    const result = execCli(
      ["resolve", "@test/nonexistent@1.0.0", "--json"],
      { repo: storePath }
    );
    // resolve exits with code 2 when packages are not found
    expect(result.exitCode).toBe(2);
    expect(result.json.results).toHaveLength(1);
    expect(result.json.results[0].resolved).toBe(false);
    expect(result.json.results[0].namespace).toBeNull();
    expect(result.json.results[0].path).toBeNull();
  });

  it("consumers --json returns structured output", async () => {
    // Create a minimal installations.json to simulate a consumer
    const installationsPath = join(storePath, "installations.json");
    const installations = {
      version: "1.0.0",
      projects: {
        "/tmp/fake-project": {
          packages: {
            "@test/simple-lib": {
              version: "1.0.0",
              namespace: "global",
              signature: "abc123",
              installedAt: new Date().toISOString(),
            },
          },
        },
      },
    };
    await writeFile(installationsPath, JSON.stringify(installations, null, 2));

    const result = execCli(["consumers", "--json"], { repo: storePath });
    expect(result.exitCode).toBe(0);
    expect(result.json.consumers).toBeDefined();
    expect(result.json.consumers).toHaveLength(1);
    expect(result.json.consumers[0].projectPath).toBe("/tmp/fake-project");
    expect(result.json.consumers[0].packages[0].name).toBe("@test/simple-lib");
  });

  it("list --json with no filters → shows all namespaces", () => {
    const result = execCli(["list", "--json"], { repo: storePath });
    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveProperty("namespaces");
    // We published to global and feature namespaces in beforeAll
    expect(result.json.namespaces).toHaveProperty("global");
    expect(result.json.namespaces).toHaveProperty("feature");
  });

  it("list --json -n global → shows only global namespace", () => {
    const result = execCli(["list", "--json", "-n", "global"], { repo: storePath });
    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveProperty("namespaces");
    expect(result.json.namespaces).toHaveProperty("global");
    expect(result.json.namespaces).not.toHaveProperty("feature");
  });

  it("list --json -p @test/simple-lib → shows only that package", () => {
    const result = execCli(["list", "--json", "-p", "@test/simple-lib"], { repo: storePath });
    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveProperty("namespaces");
    // Should contain @test/simple-lib in at least one namespace
    const allPackages = Object.values(result.json.namespaces).flatMap(
      (ns: any) => Object.keys(ns.packages || {})
    );
    expect(allPackages).toContain("@test/simple-lib");
    // Should not contain other packages
    const nonMatchingPackages = allPackages.filter((p: string) => p !== "@test/simple-lib");
    expect(nonMatchingPackages).toHaveLength(0);
  });

  it("consumers --json -p @test/simple-lib → filters by package", async () => {
    // Set up installations with multiple packages
    const installationsPath = join(storePath, "installations.json");
    const installations = {
      version: "1.0.0",
      projects: {
        "/tmp/project-a": {
          packages: {
            "@test/simple-lib": {
              version: "1.0.0",
              namespace: "global",
              signature: "abc123",
              installedAt: new Date().toISOString(),
            },
            "@test/other-pkg": {
              version: "1.0.0",
              namespace: "global",
              signature: "def456",
              installedAt: new Date().toISOString(),
            },
          },
        },
        "/tmp/project-b": {
          packages: {
            "@test/other-pkg": {
              version: "2.0.0",
              namespace: "global",
              signature: "ghi789",
              installedAt: new Date().toISOString(),
            },
          },
        },
      },
    };
    await writeFile(installationsPath, JSON.stringify(installations, null, 2));

    const result = execCli(["consumers", "--json", "-p", "@test/simple-lib"], { repo: storePath });
    expect(result.exitCode).toBe(0);
    expect(result.json.consumers).toBeDefined();
    // Only project-a consumes @test/simple-lib
    expect(result.json.consumers).toHaveLength(1);
    expect(result.json.consumers[0].projectPath).toBe("/tmp/project-a");
    expect(result.json.consumers[0].packages[0].name).toBe("@test/simple-lib");
  });

  it("consumers --prune --json → prunes dead projects", async () => {
    // Set up installations with a non-existent project path
    const installationsPath = join(storePath, "installations.json");
    const installations = {
      version: "1.0.0",
      projects: {
        "/tmp/nonexistent-project-xyz": {
          packages: {
            "@test/simple-lib": {
              version: "1.0.0",
              namespace: "global",
              signature: "abc123",
              installedAt: new Date().toISOString(),
            },
          },
        },
      },
    };
    await writeFile(installationsPath, JSON.stringify(installations, null, 2));

    const result = execCli(["consumers", "--prune", "--json"], { repo: storePath });
    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveProperty("pruned");
    expect(Array.isArray(result.json.pruned)).toBe(true);
    expect(result.json.pruned).toContain("/tmp/nonexistent-project-xyz");
  });
});
