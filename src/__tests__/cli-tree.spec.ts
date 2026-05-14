/**
 * CLI Tree Tests — End-to-end tests for the tree command.
 *
 * Exercises the compiled CLI binary via subprocess, verifying monorepo
 * structure scanning with JSON output including root, installLevels,
 * and isolatedPackages fields.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { execCli } from "./helpers/cli.js";
import { decompressConsumer, createTempStore, cleanupTemp } from "./helpers/fixtures.js";

describe("CLI: Tree", { timeout: 30000 }, () => {
  let storePath: string;
  let consumerModesPath: string;
  let tempDirs: string[] = [];

  beforeAll(async () => {
    storePath = await createTempStore();
    const conDir = await decompressConsumer("consumer-modes");
    consumerModesPath = join(conDir, "consumer-modes");
    tempDirs.push(conDir);
  });

  afterAll(async () => {
    await cleanupTemp(storePath);
    for (const d of tempDirs) await cleanupTemp(d);
  });

  it("tree --json returns monorepo structure with root, installLevels, isolatedPackages", () => {
    const result = execCli(["tree", "--json"], { cwd: consumerModesPath, repo: storePath });
    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveProperty("root");
    expect(result.json).toHaveProperty("installLevels");
    expect(result.json).toHaveProperty("isolatedPackages");
    expect(result.json.root).toBe(consumerModesPath);
    expect(Array.isArray(result.json.installLevels)).toBe(true);
    expect(Array.isArray(result.json.isolatedPackages)).toBe(true);
    expect(result.json.installLevels.length).toBeGreaterThanOrEqual(1);
  });

  it("tree --json includes modules array with workspace packages", () => {
    const result = execCli(["tree", "--json"], { cwd: consumerModesPath, repo: storePath });
    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveProperty("modules");
    expect(Array.isArray(result.json.modules)).toBe(true);
    // consumer-modes has packages/app workspace
    const appModule = result.json.modules.find((m: any) => m.name === "@test/app");
    expect(appModule).toBeDefined();
  });
});
