/**
 * CLI Publishing Tests — End-to-end tests for publish and push commands.
 *
 * Exercises the compiled CLI binary via subprocess, verifying JSON output
 * structure, namespace targeting, and signature generation across publishes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { execCli, type CliResult } from "./helpers/cli.js";
import { decompressPublisher, createTempStore, cleanupTemp } from "./helpers/fixtures.js";

describe("CLI: Publishing", { timeout: 30000 }, () => {
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
  });

  afterAll(async () => {
    await cleanupTemp(storePath);
    for (const d of tempDirs) await cleanupTemp(d);
  });

  it("publishes a package and returns structured JSON", () => {
    const result = execCli(["publish", "--json"], { cwd: simpleLibPath, repo: storePath });
    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveProperty("name", "@test/simple-lib");
    expect(result.json).toHaveProperty("version", "1.0.0");
    expect(result.json).toHaveProperty("namespace", "global");
    expect(result.json).toHaveProperty("signature");
    expect(result.json).toHaveProperty("files");
    expect(result.json.files).toBeGreaterThan(0);
  });

  it("publishes to custom namespace and list shows it", () => {
    const pubResult = execCli(["publish", "--json", "-n", "feature-v2"], { cwd: simpleLibPath, repo: storePath });
    expect(pubResult.exitCode).toBe(0);
    expect(pubResult.json.namespace).toBe("feature-v2");

    const listResult = execCli(["list", "--json", "-n", "feature-v2"], { repo: storePath });
    expect(listResult.exitCode).toBe(0);
    expect(listResult.json.namespaces["feature-v2"].packages["@test/simple-lib"]).toBeDefined();
  });

  it("signature changes when content changes", () => {
    const r1 = execCli(["publish", "--json"], { cwd: simpleLibPath, repo: storePath });
    const r2 = execCli(["publish", "--json"], { cwd: simpleLibV2Path, repo: storePath });
    expect(r1.json.signature).not.toBe(r2.json.signature);
  });

  it("push --json publishes and reports consumer updates", async () => {
    // Publish first to ensure the package is in the store
    execCli(["publish", "--json"], { cwd: simpleLibPath, repo: storePath });

    // Create a fake consumer project directory
    const fakeConsumerPath = join(storePath, "fake-consumer-project");
    await mkdir(join(fakeConsumerPath, "node_modules"), { recursive: true });

    // Manually create installations.json with the fake consumer
    const installationsPath = join(storePath, "installations.json");
    const installations = {
      version: "1.0.0",
      projects: {
        [fakeConsumerPath]: {
          packages: {
            "@test/simple-lib": {
              version: "1.0.0",
              namespace: "global",
              signature: "old-signature",
              installedAt: new Date().toISOString(),
            },
          },
        },
      },
    };
    await writeFile(installationsPath, JSON.stringify(installations, null, 2));

    // Run push --json
    const pushResult = execCli(["push", "--json"], { cwd: simpleLibPath, repo: storePath });
    expect(pushResult.exitCode).toBe(0);
    expect(pushResult.json).toHaveProperty("published");
    expect(pushResult.json).toHaveProperty("consumersUpdated");
    expect(pushResult.json.published.name).toBe("@test/simple-lib");
    expect(pushResult.json.published.version).toBe("1.0.0");
    expect(pushResult.json.published.namespace).toBe("global");
    expect(pushResult.json.published).toHaveProperty("signature");
    expect(Array.isArray(pushResult.json.consumersUpdated)).toBe(true);
    expect(pushResult.json.consumersUpdated).toContain(fakeConsumerPath);
  });
});
