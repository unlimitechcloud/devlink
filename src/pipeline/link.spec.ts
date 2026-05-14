/**
 * Link Command Tests — Validates the link execution logic.
 *
 * Tests cover:
 * - Spawning npm link for each link entry in the plan
 * - Recording successes in linked[] array
 * - Recording failures in failed[] with exit codes
 * - Processing all entries regardless of individual failures (resilience)
 * - Resolving relative paths against the project path
 * - Handling absolute paths directly
 * - Reading plan input from file path or stdin
 * - Project path resolution (options > plan > cwd)
 * - Handling empty link entries
 *
 * Uses dependency injection via `executeLinkWithDeps` to avoid real npm processes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeLinkWithDeps, type LinkDeps, type SpawnLinkResult } from "./link.js";
import type { PlanOutput } from "./types.js";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a minimal valid PlanOutput for testing with link entries.
 */
function createPlanOutput(overrides: Partial<PlanOutput> = {}): PlanOutput {
  return {
    version: "1",
    mode: "dev",
    manager: "store",
    namespaces: ["global"],
    projectPath: "/project",
    packages: {
      store: [],
      registry: [],
      link: [],
      remove: [],
      skipped: [],
    },
    ...overrides,
  };
}

/**
 * Creates mock LinkDeps with configurable spawn results per path.
 */
function createMockDeps(
  results: Map<string, SpawnLinkResult> = new Map()
): LinkDeps & { calls: Array<{ resolvedPath: string; projectPath: string }> } {
  const calls: Array<{ resolvedPath: string; projectPath: string }> = [];

  return {
    calls,
    spawnLink: async (resolvedPath: string, projectPath: string) => {
      calls.push({ resolvedPath, projectPath });
      return results.get(resolvedPath) ?? { exitCode: 0 };
    },
  };
}

// ============================================================================
// Mock readPipelineInput
// ============================================================================

vi.mock("./input.js", () => ({
  readPipelineInput: vi.fn(),
}));

import { readPipelineInput } from "./input.js";
const mockReadPipelineInput = vi.mocked(readPipelineInput);

// ============================================================================
// Tests
// ============================================================================

describe("executeLinkWithDeps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("successful linking", () => {
    it("spawns npm link for each link entry and records successes", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "@webforgeai/sdk.core", version: "1.0.0", path: "/libs/sdk-core", dev: false },
            { name: "@webforgeai/sdk.http", version: "2.0.0", path: "/libs/sdk-http", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({}, deps);

      expect(result.linked).toHaveLength(2);
      expect(result.linked[0]).toEqual({ name: "@webforgeai/sdk.core", path: "/libs/sdk-core" });
      expect(result.linked[1]).toEqual({ name: "@webforgeai/sdk.http", path: "/libs/sdk-http" });
      expect(result.failed).toHaveLength(0);
    });

    it("calls spawnLink with the correct resolved path and project path", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "my-lib", version: "1.0.0", path: "/absolute/path/to/lib", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({ projectPath: "/my-project" }, deps);

      expect(deps.calls).toHaveLength(1);
      expect(deps.calls[0].resolvedPath).toBe("/absolute/path/to/lib");
      expect(deps.calls[0].projectPath).toBe("/my-project");
    });
  });

  describe("failure recording", () => {
    it("records failures with exit codes and continues processing", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "good-lib", version: "1.0.0", path: "/libs/good", dev: false },
            { name: "bad-lib", version: "1.0.0", path: "/libs/bad", dev: false },
            { name: "another-good", version: "1.0.0", path: "/libs/another", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const results = new Map<string, SpawnLinkResult>([
        ["/libs/good", { exitCode: 0 }],
        ["/libs/bad", { exitCode: 1 }],
        ["/libs/another", { exitCode: 0 }],
      ]);
      const deps = createMockDeps(results);
      const result = await executeLinkWithDeps({}, deps);

      expect(result.linked).toHaveLength(2);
      expect(result.linked[0]).toEqual({ name: "good-lib", path: "/libs/good" });
      expect(result.linked[1]).toEqual({ name: "another-good", path: "/libs/another" });

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toEqual({ name: "bad-lib", path: "/libs/bad", exitCode: 1 });
    });

    it("records different exit codes for different failures", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "fail-1", version: "1.0.0", path: "/libs/fail-1", dev: false },
            { name: "fail-2", version: "1.0.0", path: "/libs/fail-2", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const results = new Map<string, SpawnLinkResult>([
        ["/libs/fail-1", { exitCode: 127 }],
        ["/libs/fail-2", { exitCode: 2 }],
      ]);
      const deps = createMockDeps(results);
      const result = await executeLinkWithDeps({}, deps);

      expect(result.linked).toHaveLength(0);
      expect(result.failed).toHaveLength(2);
      expect(result.failed[0]).toEqual({ name: "fail-1", path: "/libs/fail-1", exitCode: 127 });
      expect(result.failed[1]).toEqual({ name: "fail-2", path: "/libs/fail-2", exitCode: 2 });
    });

    it("processes ALL entries even when all fail", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "a", version: "1.0.0", path: "/libs/a", dev: false },
            { name: "b", version: "1.0.0", path: "/libs/b", dev: false },
            { name: "c", version: "1.0.0", path: "/libs/c", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const results = new Map<string, SpawnLinkResult>([
        ["/libs/a", { exitCode: 1 }],
        ["/libs/b", { exitCode: 1 }],
        ["/libs/c", { exitCode: 1 }],
      ]);
      const deps = createMockDeps(results);
      const result = await executeLinkWithDeps({}, deps);

      // All 3 entries were processed despite all failing
      expect(deps.calls).toHaveLength(3);
      expect(result.failed).toHaveLength(3);
      expect(result.linked).toHaveLength(0);
    });
  });

  describe("path resolution", () => {
    it("resolves relative paths against the project path", async () => {
      const plan = createPlanOutput({
        projectPath: "/my-project",
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "relative-lib", version: "1.0.0", path: "../libs/relative-lib", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({}, deps);

      // ../libs/relative-lib resolved against /my-project = /libs/relative-lib
      expect(deps.calls[0].resolvedPath).toBe("/libs/relative-lib");
      expect(result.linked[0].path).toBe("/libs/relative-lib");
    });

    it("uses absolute paths directly without resolution", async () => {
      const plan = createPlanOutput({
        projectPath: "/my-project",
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "abs-lib", version: "1.0.0", path: "/absolute/path/to/lib", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({}, deps);

      expect(deps.calls[0].resolvedPath).toBe("/absolute/path/to/lib");
      expect(result.linked[0].path).toBe("/absolute/path/to/lib");
    });

    it("resolves relative paths with nested directories", async () => {
      const plan = createPlanOutput({
        projectPath: "/workspace/project",
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "nested-lib", version: "1.0.0", path: "./packages/nested-lib", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({}, deps);

      expect(deps.calls[0].resolvedPath).toBe("/workspace/project/packages/nested-lib");
      expect(result.linked[0].path).toBe("/workspace/project/packages/nested-lib");
    });
  });

  describe("project path resolution", () => {
    it("uses projectPath from options over plan output", async () => {
      const plan = createPlanOutput({
        projectPath: "/plan-project",
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "lib", version: "1.0.0", path: "/libs/lib", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({ projectPath: "/custom-project" }, deps);

      expect(result.projectPath).toBe("/custom-project");
      expect(deps.calls[0].projectPath).toBe("/custom-project");
    });

    it("falls back to plan projectPath when no option provided", async () => {
      const plan = createPlanOutput({
        projectPath: "/plan-project",
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "lib", version: "1.0.0", path: "/libs/lib", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({}, deps);

      expect(result.projectPath).toBe("/plan-project");
      expect(deps.calls[0].projectPath).toBe("/plan-project");
    });
  });

  describe("input handling", () => {
    it("passes plan file path to readPipelineInput", async () => {
      const plan = createPlanOutput();
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      await executeLinkWithDeps({ plan: "/tmp/plan.json" }, deps);

      expect(mockReadPipelineInput).toHaveBeenCalledWith("/tmp/plan.json");
    });

    it("passes undefined when no plan file path provided (reads from stdin)", async () => {
      const plan = createPlanOutput();
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      await executeLinkWithDeps({}, deps);

      expect(mockReadPipelineInput).toHaveBeenCalledWith(undefined);
    });
  });

  describe("empty link entries", () => {
    it("returns empty linked and failed arrays when no link entries exist", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "store-pkg", version: "1.0.0", namespace: "global", path: "/store/pkg" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({}, deps);

      expect(result.linked).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(deps.calls).toHaveLength(0);
    });
  });

  describe("output structure", () => {
    it("produces correct LinkOutput structure", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "lib-a", version: "1.0.0", path: "/libs/a", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({}, deps);

      expect(result).toHaveProperty("projectPath");
      expect(result).toHaveProperty("linked");
      expect(result).toHaveProperty("failed");
      expect(Array.isArray(result.linked)).toBe(true);
      expect(Array.isArray(result.failed)).toBe(true);
    });

    it("linked entries contain name and resolved path", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "@scope/my-lib", version: "2.0.0", path: "/libs/my-lib", dev: true },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeLinkWithDeps({}, deps);

      expect(result.linked[0]).toEqual({
        name: "@scope/my-lib",
        path: "/libs/my-lib",
      });
    });

    it("failed entries contain name, resolved path, and exit code", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [
            { name: "broken-lib", version: "1.0.0", path: "/libs/broken", dev: false },
          ],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const results = new Map<string, SpawnLinkResult>([
        ["/libs/broken", { exitCode: 42 }],
      ]);
      const deps = createMockDeps(results);
      const result = await executeLinkWithDeps({}, deps);

      expect(result.failed[0]).toEqual({
        name: "broken-lib",
        path: "/libs/broken",
        exitCode: 42,
      });
    });
  });
});
