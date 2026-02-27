/**
 * Unit Tests - Multi-Level Installer
 *
 * Tests for installMultiLevel with mocked installPackages and npm install.
 *
 * Simplified model (root-only DevLink):
 * - Root level: calls installPackages (DevLink staging + injection + npm)
 * - Sub-monorepos: skipped (resolved by root workspace install)
 * - Isolated packages: npm install only (no DevLink)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";
import type { MonorepoTree, InstallLevel } from "../types.js";

// Mock dependencies before importing the module under test
vi.mock("../commands/install.js", () => ({
  installPackages: vi.fn().mockResolvedValue({
    installed: [],
    removed: [],
    skipped: [],
  }),
}));

vi.mock("./tree.js", () => ({
}));

// Dynamic import after mocks are set up
const { installMultiLevel, runNpmAtLevel } = await import("./multilevel.js");
const { installPackages } = await import("../commands/install.js");

describe("Multi-Level Installer", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devlink-multilevel-test-"));
    originalCwd = process.cwd();
    vi.clearAllMocks();

    // Re-establish default mock return values after clearAllMocks
    vi.mocked(installPackages).mockResolvedValue({
      installed: [],
      removed: [],
      skipped: [],
    } as any);

    // Suppress console.log during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Helpers
  // =========================================================================

  function makeTree(overrides?: Partial<MonorepoTree>): MonorepoTree {
    return {
      root: tmpDir,
      modules: [],
      installLevels: [
        {
          path: tmpDir,
          relativePath: ".",
          workspaces: ["packages/*"],
        },
      ],
      isolatedPackages: [],
      ...overrides,
    };
  }

  async function ensureDirs(...dirs: string[]): Promise<void> {
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
      const pkgPath = path.join(dir, "package.json");
      try {
        await fs.access(pkgPath);
      } catch {
        await fs.writeFile(pkgPath, JSON.stringify({ name: "test", version: "1.0.0" }));
      }
    }
  }

  // =========================================================================
  // Root-only DevLink
  // =========================================================================
  it("calls installPackages at root level only", async () => {
    await ensureDirs(tmpDir);

    const tree = makeTree();

    const result = await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: true,
    });

    expect(result.success).toBe(true);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].relativePath).toBe(".");
    expect(installPackages).toHaveBeenCalledTimes(1);
    expect(installPackages).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "dev", runNpm: true }),
    );
  });

  it("does NOT pass tree to installPackages (root-only injection)", async () => {
    await ensureDirs(tmpDir);

    const tree = makeTree();

    await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: true,
    });

    const callArgs = vi.mocked(installPackages).mock.calls[0][0] as any;
    expect(callArgs.tree).toBeUndefined();
  });

  // =========================================================================
  // Sub-monorepos skipped
  // =========================================================================
  it("skips sub-monorepos (resolved by root workspace install)", async () => {
    const subPath = path.join(tmpDir, "packages", "sub");
    await ensureDirs(tmpDir, subPath);

    const tree = makeTree({
      installLevels: [
        { path: tmpDir, relativePath: ".", workspaces: [] },
        { path: subPath, relativePath: "packages/sub", workspaces: [] },
      ],
    });

    const result = await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: true,
    });

    expect(result.success).toBe(true);
    // Only root level produces a result — sub-monorepos are skipped
    expect(result.levels).toHaveLength(1);
    expect(installPackages).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // Isolated packages
  // =========================================================================
  it("runs npm install on isolated packages", async () => {
    const isoPath = path.join(tmpDir, "packages", "apps", "web", "packages", "app");
    await ensureDirs(tmpDir, isoPath);

    const tree = makeTree({
      isolatedPackages: [isoPath],
    });

    const result = await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: true,
    });

    expect(result.success).toBe(true);
    // root + isolated
    expect(result.levels).toHaveLength(2);
    expect(result.levels[1].relativePath).toContain("app");
  });

  it("skips isolated packages when runNpm is false", async () => {
    const isoPath = path.join(tmpDir, "packages", "apps", "web", "packages", "app");
    await ensureDirs(tmpDir, isoPath);

    const tree = makeTree({
      isolatedPackages: [isoPath],
    });

    const result = await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: false,
    });

    expect(result.success).toBe(true);
    // root + isolated (isolated has duration 0 since npm skipped)
    expect(result.levels).toHaveLength(2);
    expect(result.levels[1].duration).toBe(0);
  });

  // =========================================================================
  // Order: root → isolated
  // =========================================================================
  it("processes root first, then isolated packages", async () => {
    const isoPath = path.join(tmpDir, "packages", "iso");
    await ensureDirs(tmpDir, isoPath);

    const tree = makeTree({
      isolatedPackages: [isoPath],
    });

    const result = await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: true,
    });

    expect(result.success).toBe(true);
    expect(result.levels).toHaveLength(2);
    expect(result.levels[0].relativePath).toBe(".");
    expect(result.levels[1].relativePath).toContain("iso");
  });

  // =========================================================================
  // Fail-fast
  // =========================================================================
  it("stops execution on root failure (fail-fast)", async () => {
    await ensureDirs(tmpDir);

    vi.mocked(installPackages).mockRejectedValueOnce(new Error("install failed at root"));

    const isoPath = path.join(tmpDir, "packages", "iso");
    await ensureDirs(isoPath);

    const tree = makeTree({
      isolatedPackages: [isoPath],
    });

    const result = await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: true,
    });

    expect(result.success).toBe(false);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].success).toBe(false);
    expect(result.levels[0].error).toContain("install failed at root");
  });

  // =========================================================================
  // cwd restoration
  // =========================================================================
  it("restores process.cwd() after each level", async () => {
    await ensureDirs(tmpDir);

    const tree = makeTree();

    await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: false,
    });

    expect(process.cwd()).toBe(originalCwd);
  });

  it("restores process.cwd() even when a level fails", async () => {
    await ensureDirs(tmpDir);

    vi.mocked(installPackages).mockRejectedValueOnce(new Error("boom"));

    const tree = makeTree();

    await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: true,
    });

    expect(process.cwd()).toBe(originalCwd);
  });

  // =========================================================================
  // Config forwarding
  // =========================================================================
  it("forwards configName to installPackages", async () => {
    await ensureDirs(tmpDir);

    const tree = makeTree();

    await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: true,
      configName: "webforgeai.config.mjs",
    });

    expect(installPackages).toHaveBeenCalledWith(
      expect.objectContaining({ configName: "webforgeai.config.mjs" }),
    );
  });

  // =========================================================================
  // Result reporting
  // =========================================================================
  it("reports duration per level and total duration", async () => {
    await ensureDirs(tmpDir);

    const tree = makeTree();

    const result = await installMultiLevel({
      tree,
      mode: "dev",
      runNpm: false,
    });

    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    expect(result.levels[0].duration).toBeGreaterThanOrEqual(0);
  });

});
