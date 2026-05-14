/**
 * Stage Command Tests — Validates the stage execution logic.
 *
 * Tests cover:
 * - Staging directory cleanup and recreation
 * - Copying store packages to .devlink/
 * - Relinking internal dependencies to file: relative paths
 * - Semver satisfaction check for relink decisions
 * - Handling packages with no package.json
 * - Registry packages staged from npm
 * - Original store packages remain unmodified
 *
 * Uses dependency injection via `executeStageWithDeps` to avoid real filesystem
 * operations and npm calls during testing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeStageWithDeps, type StageDeps } from "./stage.js";
import type { PlanOutput } from "./types.js";

// ============================================================================
// Test Helpers
// ============================================================================

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
 * Creates mock StageDeps with in-memory filesystem simulation.
 */
function createMockDeps(overrides: Partial<StageDeps> = {}): StageDeps & {
  copiedDirs: Array<{ src: string; dest: string }>;
  removedDirs: string[];
  createdDirs: string[];
  manifests: Map<string, Record<string, any>>;
  writtenManifests: Map<string, Record<string, any>>;
} {
  const copiedDirs: Array<{ src: string; dest: string }> = [];
  const removedDirs: string[] = [];
  const createdDirs: string[] = [];
  const manifests = new Map<string, Record<string, any>>();
  const writtenManifests = new Map<string, Record<string, any>>();

  const deps: StageDeps & {
    copiedDirs: Array<{ src: string; dest: string }>;
    removedDirs: string[];
    createdDirs: string[];
    manifests: Map<string, Record<string, any>>;
    writtenManifests: Map<string, Record<string, any>>;
  } = {
    copiedDirs,
    removedDirs,
    createdDirs,
    manifests,
    writtenManifests,
    copyDir: async (src, dest) => {
      copiedDirs.push({ src, dest });
    },
    rmDir: async (dirPath) => {
      removedDirs.push(dirPath);
    },
    mkDir: async (dirPath) => {
      createdDirs.push(dirPath);
    },
    readManifest: async (manifestPath) => {
      return manifests.get(manifestPath) ?? null;
    },
    writeManifest: async (manifestPath, manifest) => {
      writtenManifests.set(manifestPath, JSON.parse(JSON.stringify(manifest)));
    },
    stageFromNpm: async () => null,
    ...overrides,
  };

  return deps;
}

/**
 * Mocks readPipelineInput by providing plan data via a temp file approach.
 * Since executeStageWithDeps calls readPipelineInput internally, we mock
 * the module at the test level.
 */

// We need to mock the input module to control what plan data is returned
vi.mock("./input.js", () => ({
  readPipelineInput: vi.fn(),
}));

import { readPipelineInput } from "./input.js";
const mockReadPipelineInput = vi.mocked(readPipelineInput);

// ============================================================================
// Tests
// ============================================================================

describe("executeStageWithDeps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("staging directory lifecycle", () => {
    it("cleans and recreates the .devlink/ staging directory", async () => {
      const plan = createPlanOutput();
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      await executeStageWithDeps({}, deps);

      expect(deps.removedDirs).toContain("/project/.devlink");
      expect(deps.createdDirs).toContain("/project/.devlink");
      // rm happens before mkdir
      const rmIndex = deps.removedDirs.indexOf("/project/.devlink");
      const mkIndex = deps.createdDirs.indexOf("/project/.devlink");
      expect(rmIndex).toBeLessThanOrEqual(mkIndex);
    });

    it("uses projectPath from options over plan output", async () => {
      const plan = createPlanOutput({ projectPath: "/plan-project" });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeStageWithDeps({ projectPath: "/custom-project" }, deps);

      expect(result.projectPath).toBe("/custom-project");
      expect(deps.removedDirs).toContain("/custom-project/.devlink");
    });

    it("falls back to plan projectPath when no option provided", async () => {
      const plan = createPlanOutput({ projectPath: "/plan-project" });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeStageWithDeps({}, deps);

      expect(result.projectPath).toBe("/plan-project");
    });
  });

  describe("copying store packages", () => {
    it("copies each store package from its store path to .devlink/{name}/", async () => {
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
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeStageWithDeps({}, deps);

      expect(deps.copiedDirs).toHaveLength(2);
      expect(deps.copiedDirs[0]).toEqual({
        src: "/store/global/@webforgeai/sdk.core/1.0.0",
        dest: "/project/.devlink/@webforgeai/sdk.core",
      });
      expect(deps.copiedDirs[1]).toEqual({
        src: "/store/global/@webforgeai/sdk.http/2.0.0",
        dest: "/project/.devlink/@webforgeai/sdk.http",
      });

      expect(result.staged).toHaveLength(2);
      expect(result.staged[0].name).toBe("@webforgeai/sdk.core");
      expect(result.staged[0].version).toBe("1.0.0");
      expect(result.staged[0].path).toBe("/project/.devlink/@webforgeai/sdk.core");
    });

    it("produces empty staged array when no store packages in plan", async () => {
      const plan = createPlanOutput();
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeStageWithDeps({}, deps);

      expect(result.staged).toHaveLength(0);
      expect(result.relinked).toHaveLength(0);
    });
  });

  describe("registry packages (npm staging)", () => {
    it("stages registry packages from npm via stageFromNpm", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [
            { name: "lodash", version: "4.17.21", namespace: "npm", path: "" },
          ],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        stageFromNpm: async (_projectPath, name, _version) => {
          return `/project/.devlink/${name}`;
        },
      });

      const result = await executeStageWithDeps({}, deps);

      expect(result.staged).toHaveLength(1);
      expect(result.staged[0].name).toBe("lodash");
      expect(result.staged[0].version).toBe("4.17.21");
      expect(result.staged[0].path).toBe("/project/.devlink/lodash");
    });

    it("skips registry packages when stageFromNpm returns null", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [],
          registry: [
            { name: "failing-pkg", version: "1.0.0", namespace: "npm", path: "" },
          ],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        stageFromNpm: async () => null,
      });

      const result = await executeStageWithDeps({}, deps);

      expect(result.staged).toHaveLength(0);
    });
  });

  describe("internal dependency relinking", () => {
    it("rewrites internal deps to file: relative paths when semver satisfies", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "@webforgeai/sdk.core", version: "1.0.0", namespace: "global", path: "/store/global/@webforgeai/sdk.core/1.0.0" },
            { name: "@webforgeai/sdk.http", version: "1.0.0", namespace: "global", path: "/store/global/@webforgeai/sdk.http/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        readManifest: async (manifestPath) => {
          if (manifestPath === "/project/.devlink/@webforgeai/sdk.http/package.json") {
            return {
              name: "@webforgeai/sdk.http",
              version: "1.0.0",
              dependencies: {
                "@webforgeai/sdk.core": "^1.0.0",
              },
            };
          }
          if (manifestPath === "/project/.devlink/@webforgeai/sdk.core/package.json") {
            return {
              name: "@webforgeai/sdk.core",
              version: "1.0.0",
              dependencies: {},
            };
          }
          return null;
        },
      });

      const result = await executeStageWithDeps({}, deps);

      expect(result.relinked).toHaveLength(1);
      expect(result.relinked[0]).toEqual({
        package: "@webforgeai/sdk.http",
        dep: "@webforgeai/sdk.core",
        from: "^1.0.0",
        to: "file:../sdk.core",
      });
    });

    it("does not rewrite deps when semver range is not satisfied", async () => {
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
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        readManifest: async (manifestPath) => {
          if (manifestPath === "/project/.devlink/@webforgeai/sdk.http/package.json") {
            return {
              name: "@webforgeai/sdk.http",
              version: "2.0.0",
              dependencies: {
                "@webforgeai/sdk.core": "^2.0.0", // Requires 2.x but only 1.0.0 is staged
              },
            };
          }
          if (manifestPath === "/project/.devlink/@webforgeai/sdk.core/package.json") {
            return {
              name: "@webforgeai/sdk.core",
              version: "1.0.0",
              dependencies: {},
            };
          }
          return null;
        },
      });

      const result = await executeStageWithDeps({}, deps);

      expect(result.relinked).toHaveLength(0);
    });

    it("rewrites peerDependencies in addition to dependencies", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "core-lib", version: "3.0.0", namespace: "global", path: "/store/global/core-lib/3.0.0" },
            { name: "plugin-lib", version: "1.0.0", namespace: "global", path: "/store/global/plugin-lib/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        readManifest: async (manifestPath) => {
          if (manifestPath === "/project/.devlink/plugin-lib/package.json") {
            return {
              name: "plugin-lib",
              version: "1.0.0",
              peerDependencies: {
                "core-lib": ">=3.0.0",
              },
            };
          }
          if (manifestPath === "/project/.devlink/core-lib/package.json") {
            return {
              name: "core-lib",
              version: "3.0.0",
              dependencies: {},
            };
          }
          return null;
        },
      });

      const result = await executeStageWithDeps({}, deps);

      expect(result.relinked).toHaveLength(1);
      expect(result.relinked[0].package).toBe("plugin-lib");
      expect(result.relinked[0].dep).toBe("core-lib");
      expect(result.relinked[0].from).toBe(">=3.0.0");
      expect(result.relinked[0].to).toBe("file:../core-lib");
    });

    it("skips packages with no package.json (readManifest returns null)", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "no-manifest-pkg", version: "1.0.0", namespace: "global", path: "/store/global/no-manifest-pkg/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        readManifest: async () => null,
      });

      const result = await executeStageWithDeps({}, deps);

      expect(result.staged).toHaveLength(1);
      expect(result.relinked).toHaveLength(0);
      expect(deps.writtenManifests.size).toBe(0);
    });

    it("does not rewrite external dependencies not in staging", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "my-pkg", version: "1.0.0", namespace: "global", path: "/store/global/my-pkg/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        readManifest: async (manifestPath) => {
          if (manifestPath === "/project/.devlink/my-pkg/package.json") {
            return {
              name: "my-pkg",
              version: "1.0.0",
              dependencies: {
                "express": "^4.18.0",
                "lodash": "^4.17.0",
              },
            };
          }
          return null;
        },
      });

      const result = await executeStageWithDeps({}, deps);

      expect(result.relinked).toHaveLength(0);
      // Manifest should not be written since nothing was modified
      expect(deps.writtenManifests.size).toBe(0);
    });

    it("writes manifest only when modifications are made", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "pkg-a", version: "1.0.0", namespace: "global", path: "/store/global/pkg-a/1.0.0" },
            { name: "pkg-b", version: "1.0.0", namespace: "global", path: "/store/global/pkg-b/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        readManifest: async (manifestPath) => {
          if (manifestPath === "/project/.devlink/pkg-a/package.json") {
            return {
              name: "pkg-a",
              version: "1.0.0",
              dependencies: { "pkg-b": "^1.0.0" },
            };
          }
          if (manifestPath === "/project/.devlink/pkg-b/package.json") {
            return {
              name: "pkg-b",
              version: "1.0.0",
              dependencies: { "external": "^2.0.0" },
            };
          }
          return null;
        },
      });

      const result = await executeStageWithDeps({}, deps);

      // Only pkg-a should have its manifest written (it has an internal dep relinked)
      expect(deps.writtenManifests.has("/project/.devlink/pkg-a/package.json")).toBe(true);
      expect(deps.writtenManifests.has("/project/.devlink/pkg-b/package.json")).toBe(false);
    });
  });

  describe("output structure", () => {
    it("produces correct StageOutput structure", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "my-pkg", version: "1.0.0", namespace: "global", path: "/store/global/my-pkg/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        readManifest: async () => ({
          name: "my-pkg",
          version: "1.0.0",
          dependencies: {},
        }),
      });

      const result = await executeStageWithDeps({}, deps);

      expect(result).toHaveProperty("projectPath", "/project");
      expect(result).toHaveProperty("stagingDir", ".devlink");
      expect(result).toHaveProperty("staged");
      expect(result).toHaveProperty("relinked");
      expect(Array.isArray(result.staged)).toBe(true);
      expect(Array.isArray(result.relinked)).toBe(true);
    });

    it("staged entries contain name, version, and absolute path", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "@scope/pkg", version: "2.5.0", namespace: "team", path: "/store/team/@scope/pkg/2.5.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      const result = await executeStageWithDeps({}, deps);

      expect(result.staged[0]).toEqual({
        name: "@scope/pkg",
        version: "2.5.0",
        path: "/project/.devlink/@scope/pkg",
      });
    });
  });

  describe("plan input handling", () => {
    it("passes plan file path to readPipelineInput", async () => {
      const plan = createPlanOutput();
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      await executeStageWithDeps({ plan: "/tmp/plan.json" }, deps);

      expect(mockReadPipelineInput).toHaveBeenCalledWith("/tmp/plan.json");
    });

    it("passes undefined to readPipelineInput when no plan option (reads from stdin)", async () => {
      const plan = createPlanOutput();
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps();
      await executeStageWithDeps({}, deps);

      expect(mockReadPipelineInput).toHaveBeenCalledWith(undefined);
    });
  });

  describe("store immutability", () => {
    it("copies from store path to staging — never writes to store paths", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "pkg-a", version: "1.0.0", namespace: "global", path: "/store/global/pkg-a/1.0.0" },
            { name: "pkg-b", version: "1.0.0", namespace: "global", path: "/store/global/pkg-b/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        readManifest: async (manifestPath) => {
          if (manifestPath === "/project/.devlink/pkg-a/package.json") {
            return {
              name: "pkg-a",
              version: "1.0.0",
              dependencies: { "pkg-b": "^1.0.0" },
            };
          }
          if (manifestPath === "/project/.devlink/pkg-b/package.json") {
            return {
              name: "pkg-b",
              version: "1.0.0",
              dependencies: {},
            };
          }
          return null;
        },
      });

      const result = await executeStageWithDeps({}, deps);

      // Verify that all written manifests are in .devlink/, not in /store/
      for (const [writtenPath] of deps.writtenManifests) {
        expect(writtenPath).toContain("/project/.devlink/");
        expect(writtenPath).not.toContain("/store/");
      }

      // Verify that copyDir source is the store path, dest is staging
      for (const { src, dest } of deps.copiedDirs) {
        expect(src).toContain("/store/");
        expect(dest).toContain("/project/.devlink/");
      }
    });
  });

  describe("multiple internal dependencies", () => {
    it("relinks multiple internal deps in a single package", async () => {
      const plan = createPlanOutput({
        packages: {
          store: [
            { name: "core", version: "1.0.0", namespace: "global", path: "/store/global/core/1.0.0" },
            { name: "utils", version: "1.0.0", namespace: "global", path: "/store/global/utils/1.0.0" },
            { name: "app", version: "1.0.0", namespace: "global", path: "/store/global/app/1.0.0" },
          ],
          registry: [],
          link: [],
          remove: [],
          skipped: [],
        },
      });
      mockReadPipelineInput.mockResolvedValue(plan);

      const deps = createMockDeps({
        readManifest: async (manifestPath) => {
          if (manifestPath === "/project/.devlink/app/package.json") {
            return {
              name: "app",
              version: "1.0.0",
              dependencies: {
                "core": "^1.0.0",
                "utils": "^1.0.0",
                "express": "^4.0.0",
              },
            };
          }
          if (manifestPath === "/project/.devlink/core/package.json") {
            return { name: "core", version: "1.0.0", dependencies: {} };
          }
          if (manifestPath === "/project/.devlink/utils/package.json") {
            return { name: "utils", version: "1.0.0", dependencies: {} };
          }
          return null;
        },
      });

      const result = await executeStageWithDeps({}, deps);

      // app should have both core and utils relinked, but not express
      const appRelinks = result.relinked.filter(r => r.package === "app");
      expect(appRelinks).toHaveLength(2);
      expect(appRelinks.map(r => r.dep).sort()).toEqual(["core", "utils"]);
    });
  });
});
