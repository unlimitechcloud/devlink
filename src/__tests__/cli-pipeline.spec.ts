/**
 * CLI Pipeline Tests — End-to-end tests for stage, inject, link, and install --json commands.
 *
 * Exercises the composable pipeline commands via subprocess, verifying structured
 * JSON output at each step: plan → stage → inject → install --json.
 * Hydrate and apply are skipped as they require npm install (slow/flaky).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { writeFile } from "fs/promises";
import { execCli } from "./helpers/cli.js";
import {
  decompressPublisher,
  decompressConsumer,
  createTempStore,
  cleanupTemp,
} from "./helpers/fixtures.js";

describe("CLI: Pipeline", { timeout: 30000 }, () => {
  let storePath: string;
  let consumerModesPath: string;
  let tempDirs: string[] = [];

  beforeAll(async () => {
    storePath = await createTempStore();

    // Decompress and publish all publisher fixtures
    const pubDir1 = await decompressPublisher("simple-lib");
    tempDirs.push(pubDir1);
    execCli(["publish", "--json"], { cwd: join(pubDir1, "simple-lib"), repo: storePath });

    const pubDir2 = await decompressPublisher("lib-with-deps");
    tempDirs.push(pubDir2);
    execCli(["publish", "--json"], { cwd: join(pubDir2, "lib-with-deps"), repo: storePath });

    const pubDir3 = await decompressPublisher("synthetic-pkg");
    tempDirs.push(pubDir3);
    execCli(["publish", "--json"], { cwd: join(pubDir3, "synthetic-pkg"), repo: storePath });

    const pubDir4 = await decompressPublisher("lib-with-bin");
    tempDirs.push(pubDir4);
    execCli(["publish", "--json"], { cwd: join(pubDir4, "lib-with-bin"), repo: storePath });

    // Decompress consumer fixture
    const conDir = await decompressConsumer("consumer-modes");
    consumerModesPath = join(conDir, "consumer-modes");
    tempDirs.push(conDir);
  });

  afterAll(async () => {
    await cleanupTemp(storePath);
    for (const d of tempDirs) await cleanupTemp(d);
  });

  it("stage --plan <file> --json → staged and relinked arrays", async () => {
    // First, generate a plan
    const planResult = execCli(
      ["plan", "--json", "--mode", "dev"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(planResult.exitCode).toBe(0);

    // Write plan to a temp file
    const planFile = join(consumerModesPath, "plan.json");
    await writeFile(planFile, JSON.stringify(planResult.json, null, 2));

    // Run stage with the plan file
    const stageResult = execCli(
      ["stage", "--plan", planFile, "--json"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(stageResult.exitCode).toBe(0);
    expect(stageResult.json).toHaveProperty("projectPath");
    expect(stageResult.json).toHaveProperty("stagingDir");
    expect(stageResult.json).toHaveProperty("staged");
    expect(stageResult.json).toHaveProperty("relinked");
    expect(Array.isArray(stageResult.json.staged)).toBe(true);
    expect(stageResult.json.staged.length).toBeGreaterThan(0);

    // Each staged entry should have name, version, path
    const firstStaged = stageResult.json.staged[0];
    expect(firstStaged).toHaveProperty("name");
    expect(firstStaged).toHaveProperty("version");
    expect(firstStaged).toHaveProperty("path");
  });

  it("inject --stage <file> --plan <file> --json → injected and synthetic arrays", async () => {
    // Generate plan
    const planResult = execCli(
      ["plan", "--json", "--mode", "dev"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(planResult.exitCode).toBe(0);
    const planFile = join(consumerModesPath, "plan.json");
    await writeFile(planFile, JSON.stringify(planResult.json, null, 2));

    // Run stage
    const stageResult = execCli(
      ["stage", "--plan", planFile, "--json"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(stageResult.exitCode).toBe(0);
    const stageFile = join(consumerModesPath, "stage.json");
    await writeFile(stageFile, JSON.stringify(stageResult.json, null, 2));

    // Run inject
    const injectResult = execCli(
      ["inject", "--stage", stageFile, "--plan", planFile, "--json"],
      { cwd: consumerModesPath, repo: storePath }
    );
    expect(injectResult.exitCode).toBe(0);
    expect(injectResult.json).toHaveProperty("projectPath");
    expect(injectResult.json).toHaveProperty("modified");
    expect(injectResult.json).toHaveProperty("injected");
    expect(injectResult.json).toHaveProperty("synthetic");
    expect(Array.isArray(injectResult.json.injected)).toBe(true);
    expect(Array.isArray(injectResult.json.synthetic)).toBe(true);
    expect(injectResult.json.injected.length).toBeGreaterThan(0);

    // Each injected entry should have name, target, value
    const firstInjected = injectResult.json.injected[0];
    expect(firstInjected).toHaveProperty("name");
    expect(firstInjected).toHaveProperty("target");
    expect(firstInjected).toHaveProperty("value");

    // consumer-modes has @test/synthetic-sst as synthetic
    expect(injectResult.json.synthetic).toContain("@test/synthetic-sst");
  });

  it("link --plan <file> --json → linked and failed arrays", async () => {
    // Create a plan with link entries pointing to non-existent paths
    const fakePlan = {
      version: "1",
      mode: "dev",
      manager: "store",
      namespaces: ["global"],
      projectPath: consumerModesPath,
      packages: {
        store: [],
        registry: [],
        link: [
          { name: "@test/fake-link", version: "1.0.0", path: "/tmp/nonexistent-link-target", dev: false },
        ],
        remove: [],
        skipped: [],
      },
    };
    const planFile = join(consumerModesPath, "link-plan.json");
    await writeFile(planFile, JSON.stringify(fakePlan, null, 2));

    // Run link — it will fail for the fake path but we verify the output structure
    const linkResult = execCli(
      ["link", "--plan", planFile, "--json"],
      { cwd: consumerModesPath, repo: storePath }
    );
    // link may exit 0 even with failures (reports them in the output)
    expect(linkResult.json).toHaveProperty("projectPath");
    expect(linkResult.json).toHaveProperty("linked");
    expect(linkResult.json).toHaveProperty("failed");
    expect(Array.isArray(linkResult.json.linked)).toBe(true);
    expect(Array.isArray(linkResult.json.failed)).toBe(true);

    // The fake link should appear in the failed array
    const failedEntry = linkResult.json.failed.find((f: any) => f.name === "@test/fake-link");
    expect(failedEntry).toBeDefined();
    expect(failedEntry).toHaveProperty("path");
    expect(failedEntry).toHaveProperty("exitCode");
  });

  it("install --json --mode dev --npm-ignore-scripts → full trace structure", () => {
    // Use a fresh consumer to avoid interference from previous inject
    // Re-decompress consumer-modes for a clean state
    const result = execCli(
      ["install", "--json", "--mode", "dev", "--npm-ignore-scripts"],
      { cwd: consumerModesPath, repo: storePath }
    );
    // install --json returns the full trace even if npm install has issues
    // We verify the structure regardless of success
    expect(result.json).toHaveProperty("projectPath");
    expect(result.json).toHaveProperty("success");
    expect(result.json).toHaveProperty("trace");
    expect(result.json.trace).toHaveProperty("plan");
    expect(result.json.trace).toHaveProperty("stage");
    expect(result.json.trace).toHaveProperty("apply");

    // Verify plan trace
    expect(result.json.trace.plan).toHaveProperty("mode", "dev");
    expect(result.json.trace.plan).toHaveProperty("packages");
    expect(result.json.trace.plan.packages).toHaveProperty("store");

    // Verify stage trace
    expect(result.json.trace.stage).toHaveProperty("staged");
    expect(result.json.trace.stage).toHaveProperty("relinked");

    // Verify apply trace (inject + hydrate)
    expect(result.json.trace.apply).toHaveProperty("trace");
    expect(result.json.trace.apply.trace).toHaveProperty("inject");
    expect(result.json.trace.apply.trace).toHaveProperty("hydrate");
  });
});
