/**
 * Install Recursive — Unit tests for executeInstallRecursiveWithDeps.
 *
 * Tests the recursive pipeline execution across monorepo install levels
 * and isolated packages, verifying correct ordering, continue-on-failure
 * behavior, and structured output format.
 */

import { describe, it, expect, vi } from "vitest";
import { executeInstallRecursiveWithDeps, type RecursiveInstallDeps } from "./install.js";
import type { MonorepoTree } from "../types.js";
import type { InstallOutput, InstallOptions } from "./types.js";

// ============================================================================
// Test Helpers
// ============================================================================

/** Creates a no-op chdir/cwd pair that tracks calls without touching the filesystem. */
function createMockChdir() {
  let currentDir = "/project";
  return {
    chdir: vi.fn((dir: string) => { currentDir = dir; }),
    cwd: vi.fn(() => currentDir),
  };
}

// ============================================================================
// Test Helpers
// ============================================================================

function createMockTree(overrides?: Partial<MonorepoTree>): MonorepoTree {
  return {
    root: "/project",
    modules: [],
    installLevels: [
      { path: "/project", relativePath: ".", workspaces: ["packages/*"] },
    ],
    isolatedPackages: [],
    ...overrides,
  };
}

function createSuccessInstallOutput(projectPath: string): InstallOutput {
  return {
    projectPath,
    success: true,
    trace: {
      plan: {
        version: "1",
        mode: "dev",
        manager: "store",
        namespaces: ["default"],
        projectPath,
        packages: { store: [], registry: [], link: [], remove: [], skipped: [] },
      },
      stage: {
        projectPath,
        stagingDir: ".devlink",
        staged: [],
        relinked: [],
      },
      apply: {
        projectPath,
        success: true,
        trace: {
          inject: {
            projectPath,
            modified: "package.json",
            injected: [],
            registry: [],
            removed: [],
            synthetic: [],
          },
          hydrate: {
            projectPath,
            success: true,
            trace: {
              "npm-install": { projectPath, exitCode: 0, args: ["install"] },
              link: { projectPath, linked: [], failed: [] },
            },
          },
        },
      },
    },
  };
}

function createFailedInstallOutput(projectPath: string): InstallOutput {
  return {
    projectPath,
    success: false,
    trace: {
      plan: { error: "Config not found" } as any,
      stage: undefined as any,
      apply: undefined as any,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("executeInstallRecursiveWithDeps", () => {
  describe("single level — root only", () => {
    it("executes pipeline at root and reports success", async () => {
      const tree = createMockTree();
      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockResolvedValue(createSuccessInstallOutput("/project")),
        executeNpmInstall: vi.fn(),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);

      expect(result.success).toBe(true);
      expect(result.recursive).toBe(true);
      expect(result.projectPath).toBe("/project");
      expect(result.levels).toHaveLength(1);
      expect(result.levels[0].path).toBe("/project");
      expect(result.levels[0].relativePath).toBe(".");
      expect(result.levels[0].success).toBe(true);
      expect(result.levels[0].trace).toBeDefined();
      expect(result.isolatedPackages).toHaveLength(0);
    });
  });

  describe("multiple levels — root + sub-monorepos", () => {
    it("executes pipeline at each level in order", async () => {
      const tree = createMockTree({
        installLevels: [
          { path: "/project", relativePath: ".", workspaces: ["services/*"] },
          { path: "/project/services/api", relativePath: "services/api", workspaces: ["packages/*"] },
        ],
      });

      const callOrder: string[] = [];
      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockImplementation(async () => {
          callOrder.push(mockChdir.cwd());
          return createSuccessInstallOutput(mockChdir.cwd());
        }),
        executeNpmInstall: vi.fn(),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);

      expect(result.success).toBe(true);
      expect(result.levels).toHaveLength(2);
      expect(result.levels[0].relativePath).toBe(".");
      expect(result.levels[1].relativePath).toBe("services/api");
      expect(callOrder).toEqual(["/project", "/project/services/api"]);
    });
  });

  describe("isolated packages", () => {
    it("runs npm install for isolated packages", async () => {
      const tree = createMockTree({
        isolatedPackages: ["/project/tools/isolated-pkg"],
      });

      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockResolvedValue(createSuccessInstallOutput("/project")),
        executeNpmInstall: vi.fn().mockResolvedValue({
          projectPath: "/project/tools/isolated-pkg",
          exitCode: 0,
          args: ["install", "--no-audit", "--legacy-peer-deps"],
        }),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);

      expect(result.success).toBe(true);
      expect(result.isolatedPackages).toHaveLength(1);
      expect(result.isolatedPackages[0].path).toBe("/project/tools/isolated-pkg");
      expect(result.isolatedPackages[0].relativePath).toBe("tools/isolated-pkg");
      expect(result.isolatedPackages[0].success).toBe(true);
      expect(result.isolatedPackages[0].npmExitCode).toBe(0);
      expect(deps.executeNpmInstall).toHaveBeenCalledWith({
        projectPath: "/project/tools/isolated-pkg",
        ignoreScripts: undefined,
        json: undefined,
      });
    });
  });

  describe("continue on failure", () => {
    it("continues to next level when a level fails", async () => {
      const tree = createMockTree({
        installLevels: [
          { path: "/project", relativePath: ".", workspaces: ["services/*"] },
          { path: "/project/services/api", relativePath: "services/api", workspaces: [] },
        ],
      });

      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn()
          .mockResolvedValueOnce(createFailedInstallOutput("/project"))
          .mockResolvedValueOnce(createSuccessInstallOutput("/project/services/api")),
        executeNpmInstall: vi.fn(),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);

      expect(result.success).toBe(false);
      expect(result.levels).toHaveLength(2);
      expect(result.levels[0].success).toBe(false);
      expect(result.levels[1].success).toBe(true);
      // Both levels were attempted
      expect(deps.executeInstall).toHaveBeenCalledTimes(2);
    });

    it("continues to isolated packages when a level fails", async () => {
      const tree = createMockTree({
        isolatedPackages: ["/project/tools/pkg"],
      });

      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockResolvedValue(createFailedInstallOutput("/project")),
        executeNpmInstall: vi.fn().mockResolvedValue({
          projectPath: "/project/tools/pkg",
          exitCode: 0,
          args: ["install"],
        }),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);

      expect(result.success).toBe(false);
      expect(result.levels[0].success).toBe(false);
      expect(result.isolatedPackages[0].success).toBe(true);
      // Both were attempted
      expect(deps.executeNpmInstall).toHaveBeenCalledTimes(1);
    });

    it("reports failure when isolated package npm install fails", async () => {
      const tree = createMockTree({
        isolatedPackages: ["/project/tools/broken-pkg"],
      });

      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockResolvedValue(createSuccessInstallOutput("/project")),
        executeNpmInstall: vi.fn().mockResolvedValue({
          projectPath: "/project/tools/broken-pkg",
          exitCode: 1,
          args: ["install"],
        }),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);

      expect(result.success).toBe(false);
      expect(result.levels[0].success).toBe(true);
      expect(result.isolatedPackages[0].success).toBe(false);
      expect(result.isolatedPackages[0].npmExitCode).toBe(1);
    });

    it("handles exceptions from executeInstall gracefully", async () => {
      const tree = createMockTree();

      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockRejectedValue(new Error("Unexpected crash")),
        executeNpmInstall: vi.fn(),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);

      expect(result.success).toBe(false);
      expect(result.levels[0].success).toBe(false);
      expect(result.levels[0].error).toBe("Unexpected crash");
    });

    it("handles exceptions from executeNpmInstall gracefully", async () => {
      const tree = createMockTree({
        isolatedPackages: ["/project/tools/crash-pkg"],
      });

      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockResolvedValue(createSuccessInstallOutput("/project")),
        executeNpmInstall: vi.fn().mockRejectedValue(new Error("Spawn failed")),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);

      expect(result.success).toBe(false);
      expect(result.isolatedPackages[0].success).toBe(false);
      expect(result.isolatedPackages[0].error).toBe("Spawn failed");
    });
  });

  describe("options propagation", () => {
    it("propagates all options to executeInstall at each level", async () => {
      const tree = createMockTree();
      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockResolvedValue(createSuccessInstallOutput("/project")),
        executeNpmInstall: vi.fn(),
        ...mockChdir,
      };

      await executeInstallRecursiveWithDeps(tree, {
        config: "/path/to/config.mjs",
        configName: "webforgeai.config.mjs",
        configKey: "devlink",
        mode: "dev",
        namespaces: ["global", "team"],
        packages: ["@webforgeai/sdk.core"],
        ignoreScripts: true,
        json: true,
      }, deps);

      expect(deps.executeInstall).toHaveBeenCalledWith({
        config: "/path/to/config.mjs",
        configName: "webforgeai.config.mjs",
        configKey: "devlink",
        mode: "dev",
        namespaces: ["global", "team"],
        packages: ["@webforgeai/sdk.core"],
        ignoreScripts: true,
        json: true,
      });
    });

    it("propagates ignoreScripts to isolated package npm install", async () => {
      const tree = createMockTree({
        isolatedPackages: ["/project/tools/pkg"],
      });

      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockResolvedValue(createSuccessInstallOutput("/project")),
        executeNpmInstall: vi.fn().mockResolvedValue({
          projectPath: "/project/tools/pkg",
          exitCode: 0,
          args: ["install"],
        }),
        ...mockChdir,
      };

      await executeInstallRecursiveWithDeps(tree, { ignoreScripts: true, json: true }, deps);

      expect(deps.executeNpmInstall).toHaveBeenCalledWith({
        projectPath: "/project/tools/pkg",
        ignoreScripts: true,
        json: true,
      });
    });
  });

  describe("output structure", () => {
    it("produces correct RecursiveInstallOutput structure", async () => {
      const tree = createMockTree({
        installLevels: [
          { path: "/project", relativePath: ".", workspaces: ["packages/*"] },
          { path: "/project/services/api", relativePath: "services/api", workspaces: [] },
        ],
        isolatedPackages: ["/project/tools/isolated"],
      });

      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockResolvedValue(createSuccessInstallOutput("/project")),
        executeNpmInstall: vi.fn().mockResolvedValue({
          projectPath: "/project/tools/isolated",
          exitCode: 0,
          args: ["install"],
        }),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);

      // Verify top-level structure
      expect(result).toHaveProperty("projectPath", "/project");
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("recursive", true);
      expect(result).toHaveProperty("levels");
      expect(result).toHaveProperty("isolatedPackages");

      // Verify levels structure
      expect(result.levels[0]).toHaveProperty("path");
      expect(result.levels[0]).toHaveProperty("relativePath");
      expect(result.levels[0]).toHaveProperty("success");
      expect(result.levels[0]).toHaveProperty("trace");

      // Verify isolated packages structure
      expect(result.isolatedPackages[0]).toHaveProperty("path");
      expect(result.isolatedPackages[0]).toHaveProperty("relativePath");
      expect(result.isolatedPackages[0]).toHaveProperty("success");
      expect(result.isolatedPackages[0]).toHaveProperty("npmExitCode");
    });

    it("overall success is true only when all levels and isolated packages succeed", async () => {
      const tree = createMockTree({
        installLevels: [
          { path: "/project", relativePath: ".", workspaces: [] },
        ],
        isolatedPackages: ["/project/tools/a", "/project/tools/b"],
      });

      const mockChdir = createMockChdir();
      const deps: RecursiveInstallDeps = {
        executeInstall: vi.fn().mockResolvedValue(createSuccessInstallOutput("/project")),
        executeNpmInstall: vi.fn()
          .mockResolvedValueOnce({ projectPath: "/project/tools/a", exitCode: 0, args: [] })
          .mockResolvedValueOnce({ projectPath: "/project/tools/b", exitCode: 0, args: [] }),
        ...mockChdir,
      };

      const result = await executeInstallRecursiveWithDeps(tree, {}, deps);
      expect(result.success).toBe(true);
    });
  });
});
