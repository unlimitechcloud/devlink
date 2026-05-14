/**
 * CLI Installation Tests — End-to-end tests for the plan command.
 *
 * Tests the plan command with different consumer fixture configurations.
 * We only test `plan` (not full install) because full install requires npm
 * which would be slow and flaky in tests. The plan command validates the
 * resolution logic without side effects.
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

describe("CLI: Installation (plan)", { timeout: 30000 }, () => {
  let storePath: string;
  let consumerModesPath: string;
  let consumerLegacyPath: string;
  let consumerSyntheticPath: string;
  let tempDirs: string[] = [];

  beforeAll(async () => {
    storePath = await createTempStore();

    // Decompress publisher fixtures and publish them to the store
    const pubDir = await decompressPublisher("simple-lib");
    tempDirs.push(pubDir);
    execCli(["publish", "--json"], { cwd: join(pubDir, "simple-lib"), repo: storePath });

    const pubDir2 = await decompressPublisher("lib-with-deps");
    tempDirs.push(pubDir2);
    execCli(["publish", "--json"], { cwd: join(pubDir2, "lib-with-deps"), repo: storePath });

    const pubDir3 = await decompressPublisher("synthetic-pkg");
    tempDirs.push(pubDir3);
    execCli(["publish", "--json"], { cwd: join(pubDir3, "synthetic-pkg"), repo: storePath });

    const pubDir4 = await decompressPublisher("lib-with-bin");
    tempDirs.push(pubDir4);
    execCli(["publish", "--json"], { cwd: join(pubDir4, "lib-with-bin"), repo: storePath });

    // Decompress consumer fixtures
    const conDir1 = await decompressConsumer("consumer-modes");
    consumerModesPath = join(conDir1, "consumer-modes");
    tempDirs.push(conDir1);

    const conDir2 = await decompressConsumer("consumer-legacy");
    consumerLegacyPath = join(conDir2, "consumer-legacy");
    tempDirs.push(conDir2);

    const conDir3 = await decompressConsumer("consumer-synthetic");
    consumerSyntheticPath = join(conDir3, "consumer-synthetic");
    tempDirs.push(conDir3);
  });

  afterAll(async () => {
    await cleanupTemp(storePath);
    for (const d of tempDirs) await cleanupTemp(d);
  });

  it("plan with consumer-modes --mode dev → store packages in plan", () => {
    const result = execCli(
      ["plan", "--json", "--mode", "dev"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(result.exitCode).toBe(0);
    expect(result.json.mode).toBe("dev");
    expect(result.json.manager).toBe("store");

    // @test/simple-lib should be in the store bucket
    const storePackages = result.json.packages.store;
    const simpleLib = storePackages.find((p: any) => p.name === "@test/simple-lib");
    expect(simpleLib).toBeDefined();
    expect(simpleLib.version).toBe("1.0.0");
    expect(simpleLib.namespace).toBe("global");
  });

  it("plan with consumer-modes without --mode → modes.default resolved", () => {
    // consumer-modes has modes.default = "dev", so omitting --mode should use "dev"
    const result = execCli(
      ["plan", "--json"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(result.exitCode).toBe(0);
    expect(result.json.mode).toBe("dev");
    expect(result.json.manager).toBe("store");
  });

  it("plan with consumer-legacy → backward compatibility", () => {
    // consumer-legacy uses the old format: packages with version objects + mode factory at root
    const result = execCli(
      ["plan", "--json", "--mode", "dev"],
      { cwd: consumerLegacyPath, repo: storePath }
    );
    expect(result.exitCode).toBe(0);
    expect(result.json.manager).toBe("store");

    // Should resolve @test/simple-lib from store
    const storePackages = result.json.packages.store;
    const simpleLib = storePackages.find((p: any) => p.name === "@test/simple-lib");
    expect(simpleLib).toBeDefined();
    expect(simpleLib.version).toBe("1.0.0");
  });

  it("plan with consumer-synthetic → synthetic flag in output", () => {
    const result = execCli(
      ["plan", "--json", "--mode", "dev"],
      { cwd: consumerSyntheticPath, repo: storePath }
    );
    expect(result.exitCode).toBe(0);

    // @test/synthetic-sst should have synthetic: true in the store bucket
    const storePackages = result.json.packages.store;
    const syntheticPkg = storePackages.find((p: any) => p.name === "@test/synthetic-sst");
    expect(syntheticPkg).toBeDefined();
    expect(syntheticPkg.synthetic).toBe(true);
  });

  it("plan with --packages filter → only specified package in output", () => {
    const result = execCli(
      ["plan", "--json", "--mode", "dev", "--packages", "@test/simple-lib"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(result.exitCode).toBe(0);

    // Only @test/simple-lib should be in the store bucket
    const storePackages = result.json.packages.store;
    expect(storePackages).toHaveLength(1);
    expect(storePackages[0].name).toBe("@test/simple-lib");
  });

  it("plan with dev package → dev: true in output", () => {
    const result = execCli(
      ["plan", "--json", "--mode", "dev"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(result.exitCode).toBe(0);

    // @test/cli-tool has dev: true in consumer-modes config
    const storePackages = result.json.packages.store;
    const cliTool = storePackages.find((p: any) => p.name === "@test/cli-tool");
    expect(cliTool).toBeDefined();
    expect(cliTool.dev).toBe(true);
  });

  it("plan for non-existent package → appears in skipped bucket", () => {
    const result = execCli(
      ["plan", "--json", "--mode", "dev", "--packages", "@test/nonexistent-pkg"],
      { cwd: consumerModesPath, repo: storePath }
    );
    // Plan may succeed with skipped packages or fail — depends on config
    // If the package isn't in the config, it won't appear at all
    // Let's test with a package that IS in config but NOT in store
    // consumer-modes has @test/simple-lib, @test/lib-with-deps, @test/synthetic-sst, @test/cli-tool
    // All are published. We need to remove one from the store first.
    const removeResult = execCli(
      ["remove", "@test/cli-tool@1.0.0", "--json"],
      { repo: storePath }
    );

    // Now plan should show @test/cli-tool in skipped
    const planResult = execCli(
      ["plan", "--json", "--mode", "dev", "--packages", "@test/cli-tool"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(planResult.exitCode).toBe(0);
    const skipped = planResult.json.packages.skipped;
    const skippedPkg = skipped.find((p: any) => p.name === "@test/cli-tool");
    expect(skippedPkg).toBeDefined();
    expect(skippedPkg).toHaveProperty("reason");

    // Re-publish for other tests
    const pubDir = tempDirs.find((d) => d.includes("lib-with-bin"));
    if (pubDir) {
      execCli(["publish", "--json"], { cwd: join(pubDir, "lib-with-bin"), repo: storePath });
    }
  });
});
