/**
 * Inject Command Tests — Validates the inject execution logic.
 *
 * Tests cover:
 * - Adding file: protocol entries for staged non-synthetic packages
 * - Adding version string entries for registry packages
 * - Removing packages in the remove bucket from both deps sections
 * - Skipping synthetic packages (kept in .devlink/ but not in package.json)
 * - Placing dev: true packages in devDependencies
 * - Handling packages that exist in the wrong deps section (moving them)
 * - Producing correct InjectOutput structure
 *
 * Uses dependency injection via `executeInjectWithDeps` to avoid real filesystem
 * operations during testing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeInjectWithDeps, type InjectDeps } from "./inject.js";
import type { PlanOutput, StageOutput } from "./types.js";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a minimal valid StageOutput for testing.
 */
function createStageOutput(overrides: Partial<StageOutput> = {}): StageOutput {
  return {
    projectPath: "/project",
    stagingDir: ".devlink",
    staged: [],
    relinked: [],
    ...overrides,
  };
}

/**
 * Creates a minimal valid PlanOutput for testing.
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
 * Creates mock InjectDeps with an in-memory package.json.
 */
function createMockDeps(
  initialManifest: Record<string, any> = { name: "test-project", version: "1.0.0" }
): InjectDeps & {
  writtenManifest: Record<string, any> | null;
  writtenPath: string | null;
} {
  let writtenManifest: Record<string, any> | null = null;
  let writtenPath: string | null = null;

  return {
    writtenManifest: null,
    writtenPath: null,
    readManifest: async (_manifestPath: string) => {
      return JSON.parse(JSON.stringify(initialManifest));
    },
    writeManifest: async (manifestPath: string, manifest: Record<string, any>) => {
      writtenManifest = JSON.parse(JSON.stringify(manifest));
      writtenPath = manifestPath;
      // Update the external references
      deps.writtenManifest = writtenManifest;
      deps.writtenPath = writtenPath;
    },
  };

  // Self-reference for closure update
  var deps = arguments.callee as any;
  deps = null as any; // Will be set below
}

/**
 * Better mock factory that properly tracks writes.
 */
function createDeps(
  initialManifest: Record<string, any> = { name: "test-project", version: "1.0.0" }
) {
  const state = {
    writtenManifest: null as Record<string, any> | null,
    writtenPath: null as string | null,
  };

  const deps: InjectDeps = {
    readManifest: async (_manifestPath: string) => {
      return JSON.parse(JSON.stringify(initialManifest));
    },
    writeManifest: async (manifestPath: string, manifest: Record<string, any>) => {
      state.writtenManifest = JSON.parse(JSON.stringify(manifest));
      state.writtenPath = manifestPath;
    },
  };

  return { deps, state };
}

// ============================================================================
// Mock readPipelineInput
// ============================================================================

vi.mock("./input.js", () => ({
  readPipelineInput: vi.fn(),
}));

import { readPipelineInput } from "./input.js";
const mockReadPipelineInput = vi.mocked(readPipelineInput);

/** Helper to set up mock returns for stage and plan inputs */
function setupInputMocks(stage: StageOutput, plan: PlanOutput) {
  let callCount = 0;
  mockReadPipelineInput.mockImplementation(async (_filePath?: string) => {
    callCount++;
    // First call is for stage, second is for plan
    if (callCount === 1) return stage as any;
    return plan as any;
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("executeInjectWithDeps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("file: protocol injection for staged packages", () => {
    it("adds file: entries for staged non-synthetic store packages", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "@webforgeai/sdk.core", version: "1.0.0", path: "/project/.devlink/@webforgeai/sdk.core" },
          { name: "@webforgeai/sdk.http", version: "2.0.0", path: "/project/.devlink/@webforgeai/sdk.http" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "@webforgeai/sdk.core", version: "1.0.0", namespace: "global", path: "/store/global/@webforgeai/sdk.core/1.0.0" },
            { name: "@webforgeai/sdk.http", version: "2.0.0", namespace: "global", path: "/store/global/@webforgeai/sdk.http/2.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.injected).toHaveLength(2);
      expect(result.injected[0]).toEqual({
        name: "@webforgeai/sdk.core",
        target: "dependencies",
        value: "file:.devlink/@webforgeai/sdk.core",
      });
      expect(result.injected[1]).toEqual({
        name: "@webforgeai/sdk.http",
        target: "dependencies",
        value: "file:.devlink/@webforgeai/sdk.http",
      });

      // Verify package.json was written with file: entries
      expect(state.writtenManifest!.dependencies["@webforgeai/sdk.core"]).toBe("file:.devlink/@webforgeai/sdk.core");
      expect(state.writtenManifest!.dependencies["@webforgeai/sdk.http"]).toBe("file:.devlink/@webforgeai/sdk.http");
    });

    it("skips store packages that are not in the staged list", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "@webforgeai/sdk.core", version: "1.0.0", path: "/project/.devlink/@webforgeai/sdk.core" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "@webforgeai/sdk.core", version: "1.0.0", namespace: "global", path: "/store/global/@webforgeai/sdk.core/1.0.0" },
            { name: "missing-pkg", version: "1.0.0", namespace: "global", path: "/store/global/missing-pkg/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.injected).toHaveLength(1);
      expect(result.injected[0].name).toBe("@webforgeai/sdk.core");
    });
  });

  describe("registry package injection", () => {
    it("adds version string entries for registry packages", async () => {
      const stage = createStageOutput();
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [
            { name: "lodash", version: "4.17.21", namespace: "npm", path: "" },
            { name: "express", version: "4.18.0", namespace: "npm", path: "" },
          ],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.registry).toHaveLength(2);
      expect(result.registry[0]).toEqual({
        name: "lodash",
        target: "dependencies",
        value: "4.17.21",
      });
      expect(result.registry[1]).toEqual({
        name: "express",
        target: "dependencies",
        value: "4.18.0",
      });

      expect(state.writtenManifest!.dependencies["lodash"]).toBe("4.17.21");
      expect(state.writtenManifest!.dependencies["express"]).toBe("4.18.0");
    });
  });

  describe("package removal", () => {
    it("removes packages in the remove bucket from dependencies", async () => {
      const stage = createStageOutput();
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [],
          remove: ["old-pkg", "deprecated-lib"],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "old-pkg": "^1.0.0",
          "keep-this": "^2.0.0",
        },
        devDependencies: {
          "deprecated-lib": "^3.0.0",
        },
      });
      const result = await executeInjectWithDeps({}, deps);

      expect(result.removed).toContain("old-pkg");
      expect(result.removed).toContain("deprecated-lib");
      expect(result.removed).toHaveLength(2);

      expect(state.writtenManifest!.dependencies["old-pkg"]).toBeUndefined();
      expect(state.writtenManifest!.dependencies["keep-this"]).toBe("^2.0.0");
      expect(state.writtenManifest!.devDependencies["deprecated-lib"]).toBeUndefined();
    });

    it("removes packages from both dependencies and devDependencies", async () => {
      const stage = createStageOutput();
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [],
          remove: ["dual-pkg"],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "dual-pkg": "^1.0.0" },
        devDependencies: { "dual-pkg": "^1.0.0" },
      });
      const result = await executeInjectWithDeps({}, deps);

      expect(result.removed).toContain("dual-pkg");
      expect(state.writtenManifest!.dependencies["dual-pkg"]).toBeUndefined();
      expect(state.writtenManifest!.devDependencies["dual-pkg"]).toBeUndefined();
    });

    it("does not include packages in removed if they were not in package.json", async () => {
      const stage = createStageOutput();
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [],
          link: [],
          remove: ["not-present"],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps } = createDeps({
        name: "test-project",
        version: "1.0.0",
        dependencies: {},
      });
      const result = await executeInjectWithDeps({}, deps);

      expect(result.removed).toHaveLength(0);
    });
  });

  describe("synthetic packages", () => {
    it("skips synthetic store packages — does not inject into package.json", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "real-pkg", version: "1.0.0", path: "/project/.devlink/real-pkg" },
          { name: "synthetic-pkg", version: "1.0.0", path: "/project/.devlink/synthetic-pkg" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "real-pkg", version: "1.0.0", namespace: "global", path: "/store/global/real-pkg/1.0.0" },
            { name: "synthetic-pkg", version: "1.0.0", namespace: "global", path: "/store/global/synthetic-pkg/1.0.0", synthetic: true },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.injected).toHaveLength(1);
      expect(result.injected[0].name).toBe("real-pkg");
      expect(result.synthetic).toContain("synthetic-pkg");
      expect(state.writtenManifest!.dependencies["synthetic-pkg"]).toBeUndefined();
    });

    it("skips synthetic registry packages", async () => {
      const stage = createStageOutput();
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [
            { name: "real-registry-pkg", version: "2.0.0", namespace: "npm", path: "" },
            { name: "synthetic-registry-pkg", version: "1.0.0", namespace: "npm", path: "", synthetic: true },
          ],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.registry).toHaveLength(1);
      expect(result.registry[0].name).toBe("real-registry-pkg");
      expect(result.synthetic).toContain("synthetic-registry-pkg");
      expect(state.writtenManifest!.dependencies["synthetic-registry-pkg"]).toBeUndefined();
    });
  });

  describe("dev flag placement", () => {
    it("places dev: true store packages in devDependencies", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "test-utils", version: "1.0.0", path: "/project/.devlink/test-utils" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "test-utils", version: "1.0.0", namespace: "global", path: "/store/global/test-utils/1.0.0", dev: true },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.injected).toHaveLength(1);
      expect(result.injected[0].target).toBe("devDependencies");
      expect(state.writtenManifest!.devDependencies["test-utils"]).toBe("file:.devlink/test-utils");
      expect(state.writtenManifest!.dependencies["test-utils"]).toBeUndefined();
    });

    it("places dev: true registry packages in devDependencies", async () => {
      const stage = createStageOutput();
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [
            { name: "jest", version: "29.0.0", namespace: "npm", path: "", dev: true },
          ],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.registry).toHaveLength(1);
      expect(result.registry[0].target).toBe("devDependencies");
      expect(state.writtenManifest!.devDependencies["jest"]).toBe("29.0.0");
      expect(state.writtenManifest!.dependencies["jest"]).toBeUndefined();
    });

    it("moves package from dependencies to devDependencies when dev flag is set", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "test-lib", version: "1.0.0", path: "/project/.devlink/test-lib" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "test-lib", version: "1.0.0", namespace: "global", path: "/store/global/test-lib/1.0.0", dev: true },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "test-lib": "^1.0.0" },
        devDependencies: {},
      });
      const result = await executeInjectWithDeps({}, deps);

      // Should be moved from dependencies to devDependencies
      expect(state.writtenManifest!.dependencies["test-lib"]).toBeUndefined();
      expect(state.writtenManifest!.devDependencies["test-lib"]).toBe("file:.devlink/test-lib");
    });

    it("places non-dev packages in dependencies (default)", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "prod-lib", version: "1.0.0", path: "/project/.devlink/prod-lib" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "prod-lib", version: "1.0.0", namespace: "global", path: "/store/global/prod-lib/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.injected[0].target).toBe("dependencies");
      expect(state.writtenManifest!.dependencies["prod-lib"]).toBe("file:.devlink/prod-lib");
    });
  });

  describe("project path resolution", () => {
    it("uses projectPath from options over stage/plan output", async () => {
      const stage = createStageOutput({ projectPath: "/stage-project" });
      const plan = createPlanOutput({ projectPath: "/plan-project" });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      const result = await executeInjectWithDeps({ projectPath: "/custom-project" }, deps);

      expect(result.projectPath).toBe("/custom-project");
      expect(result.modified).toBe("/custom-project/package.json");
    });

    it("falls back to stage projectPath when no option provided", async () => {
      const stage = createStageOutput({ projectPath: "/stage-project" });
      const plan = createPlanOutput({ projectPath: "/plan-project" });
      setupInputMocks(stage, plan);

      const { deps } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.projectPath).toBe("/stage-project");
    });

    it("falls back to plan projectPath when stage has no projectPath", async () => {
      const stage = createStageOutput({ projectPath: "" });
      const plan = createPlanOutput({ projectPath: "/plan-project" });
      setupInputMocks(stage, plan);

      const { deps } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.projectPath).toBe("/plan-project");
    });
  });

  describe("input handling", () => {
    it("passes stage and plan file paths to readPipelineInput", async () => {
      const stage = createStageOutput();
      const plan = createPlanOutput();
      setupInputMocks(stage, plan);

      const { deps } = createDeps();
      await executeInjectWithDeps({ stage: "/tmp/stage.json", plan: "/tmp/plan.json" }, deps);

      expect(mockReadPipelineInput).toHaveBeenCalledTimes(2);
      expect(mockReadPipelineInput).toHaveBeenNthCalledWith(1, "/tmp/stage.json");
      expect(mockReadPipelineInput).toHaveBeenNthCalledWith(2, "/tmp/plan.json");
    });

    it("passes undefined when no file paths provided (reads from stdin)", async () => {
      const stage = createStageOutput();
      const plan = createPlanOutput();
      setupInputMocks(stage, plan);

      const { deps } = createDeps();
      await executeInjectWithDeps({}, deps);

      expect(mockReadPipelineInput).toHaveBeenNthCalledWith(1, undefined);
      expect(mockReadPipelineInput).toHaveBeenNthCalledWith(2, undefined);
    });
  });

  describe("output structure", () => {
    it("produces correct InjectOutput structure", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "pkg-a", version: "1.0.0", path: "/project/.devlink/pkg-a" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "pkg-a", version: "1.0.0", namespace: "global", path: "/store/global/pkg-a/1.0.0" },
          ],
          registry: [
            { name: "lodash", version: "4.17.21", namespace: "npm", path: "" },
          ],
          link: [],
          remove: ["old-pkg"],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "old-pkg": "^1.0.0" },
      });
      const result = await executeInjectWithDeps({}, deps);

      expect(result).toHaveProperty("projectPath");
      expect(result).toHaveProperty("modified");
      expect(result).toHaveProperty("injected");
      expect(result).toHaveProperty("registry");
      expect(result).toHaveProperty("removed");
      expect(result).toHaveProperty("synthetic");
      expect(Array.isArray(result.injected)).toBe(true);
      expect(Array.isArray(result.registry)).toBe(true);
      expect(Array.isArray(result.removed)).toBe(true);
      expect(Array.isArray(result.synthetic)).toBe(true);
    });

    it("writes package.json to the correct path", async () => {
      const stage = createStageOutput({ projectPath: "/my-project" });
      const plan = createPlanOutput({ projectPath: "/my-project" });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      await executeInjectWithDeps({}, deps);

      expect(state.writtenPath).toBe("/my-project/package.json");
    });
  });

  describe("combined operations", () => {
    it("handles store, registry, remove, and synthetic in a single execution", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "real-store-pkg", version: "1.0.0", path: "/project/.devlink/real-store-pkg" },
          { name: "synthetic-store-pkg", version: "1.0.0", path: "/project/.devlink/synthetic-store-pkg" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "real-store-pkg", version: "1.0.0", namespace: "global", path: "/store/global/real-store-pkg/1.0.0" },
            { name: "synthetic-store-pkg", version: "1.0.0", namespace: "global", path: "/store/global/synthetic-store-pkg/1.0.0", synthetic: true },
          ],
          registry: [
            { name: "registry-pkg", version: "2.0.0", namespace: "npm", path: "" },
          ],
          link: [],
          remove: ["old-dep"],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "old-dep": "^1.0.0", "unrelated": "^3.0.0" },
      });
      const result = await executeInjectWithDeps({}, deps);

      // Store package injected
      expect(result.injected).toHaveLength(1);
      expect(result.injected[0].name).toBe("real-store-pkg");

      // Registry package injected
      expect(result.registry).toHaveLength(1);
      expect(result.registry[0].name).toBe("registry-pkg");

      // Synthetic tracked
      expect(result.synthetic).toContain("synthetic-store-pkg");

      // Removal performed
      expect(result.removed).toContain("old-dep");

      // Unrelated package preserved
      expect(state.writtenManifest!.dependencies["unrelated"]).toBe("^3.0.0");
    });
  });

  describe("edge cases", () => {
    it("handles package.json with no dependencies or devDependencies fields", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "new-pkg", version: "1.0.0", path: "/project/.devlink/new-pkg" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "new-pkg", version: "1.0.0", namespace: "global", path: "/store/global/new-pkg/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      // package.json with no deps fields at all
      const { deps, state } = createDeps({
        name: "bare-project",
        version: "0.1.0",
      });
      const result = await executeInjectWithDeps({}, deps);

      expect(result.injected).toHaveLength(1);
      expect(state.writtenManifest!.dependencies["new-pkg"]).toBe("file:.devlink/new-pkg");
    });

    it("handles empty plan (no packages to process)", async () => {
      const stage = createStageOutput();
      const plan = createPlanOutput();
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "existing": "^1.0.0" },
      });
      const result = await executeInjectWithDeps({}, deps);

      expect(result.injected).toHaveLength(0);
      expect(result.registry).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.synthetic).toHaveLength(0);
      // Existing deps should be preserved
      expect(state.writtenManifest!.dependencies["existing"]).toBe("^1.0.0");
    });

    it("handles scoped package names correctly in file: paths", async () => {
      const stage = createStageOutput({
        staged: [
          { name: "@scope/deep-pkg", version: "1.0.0", path: "/project/.devlink/@scope/deep-pkg" },
        ],
      });
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "@scope/deep-pkg", version: "1.0.0", namespace: "global", path: "/store/global/@scope/deep-pkg/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      setupInputMocks(stage, plan);

      const { deps, state } = createDeps();
      const result = await executeInjectWithDeps({}, deps);

      expect(result.injected[0].value).toBe("file:.devlink/@scope/deep-pkg");
      expect(state.writtenManifest!.dependencies["@scope/deep-pkg"]).toBe("file:.devlink/@scope/deep-pkg");
    });
  });
});
