/**
 * CLI Integration Tests: --packages-json parameter
 *
 * Tests the --packages-json flag on the plan and install commands.
 * This flag allows external tools (e.g. wfai CLI) to inject packages
 * dynamically that merge/override the config-declared packages.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { execCli } from "./helpers/cli.js";
import {
  decompressPublisher,
  decompressConsumer,
  createTempStore,
  cleanupTemp,
} from "./helpers/fixtures.js";

describe("CLI: --packages", { timeout: 30000 }, () => {
  let storePath: string;
  let consumerPath: string;
  let simpleLibPath: string;
  let tempDirs: string[] = [];

  beforeAll(async () => {
    storePath = await createTempStore();

    // Decompress consumer fixture (has devlink config with modes)
    const conDir = await decompressConsumer("consumer-modes");
    consumerPath = join(conDir, "consumer-modes");
    tempDirs.push(conDir);

    // Publish simple-lib to the store so it can be resolved
    const pubDir = await decompressPublisher("simple-lib");
    simpleLibPath = join(pubDir, "simple-lib");
    tempDirs.push(pubDir);

    const pub = execCli(["publish", "--json"], {
      cwd: simpleLibPath,
      repo: storePath,
    });
    expect(pub.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTemp(storePath);
    for (const d of tempDirs) await cleanupTemp(d);
  });

  describe("plan command", () => {
    it("should merge --packages into config packages", () => {
      // The consumer-modes fixture has @test/simple-lib in its config.
      // We inject an additional package via --packages.
      const override = JSON.stringify({
        "@test/injected-pkg": { version: "1.0.0" },
      });

      const result = execCli(
        ["plan", "--json", "--mode", "dev", "--packages", override],
        { cwd: consumerPath, repo: storePath }
      );

      expect(result.exitCode).toBe(0);
      expect(result.json).not.toBeNull();

      // The injected package should appear in the plan (skipped since not in store)
      const allPackageNames = [
        ...result.json.packages.store.map((p: any) => p.name),
        ...result.json.packages.registry.map((p: any) => p.name),
        ...result.json.packages.skipped.map((p: any) => p.name),
      ];
      expect(allPackageNames).toContain("@test/injected-pkg");
    });

    it("should override config-declared package version with --packages", () => {
      // Override @test/simple-lib version to something different
      const override = JSON.stringify({
        "@test/simple-lib": { version: "9.9.9" },
      });

      const result = execCli(
        ["plan", "--json", "--mode", "dev", "--packages", override],
        { cwd: consumerPath, repo: storePath }
      );

      expect(result.exitCode).toBe(0);
      expect(result.json).not.toBeNull();

      // The overridden version should be used (9.9.9 won't be in store → skipped or registry)
      const allEntries = [
        ...result.json.packages.store,
        ...result.json.packages.registry,
        ...result.json.packages.skipped,
      ];
      const simpleLib = allEntries.find((p: any) => p.name === "@test/simple-lib");
      expect(simpleLib).toBeDefined();
      expect(simpleLib.version).toBe("9.9.9");
    });

    it("should work without --packages (no override)", () => {
      const result = execCli(
        ["plan", "--json", "--mode", "dev"],
        { cwd: consumerPath, repo: storePath }
      );

      expect(result.exitCode).toBe(0);
      expect(result.json).not.toBeNull();

      // Should resolve @test/simple-lib from store at its original version
      const storePackages = result.json.packages.store;
      const simpleLib = storePackages.find((p: any) => p.name === "@test/simple-lib");
      expect(simpleLib).toBeDefined();
      expect(simpleLib.version).toBe("1.0.0");
    });
  });
});
