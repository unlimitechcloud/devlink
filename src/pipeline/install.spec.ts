/**
 * Install Command Tests — Validates the install composite execution logic.
 *
 * Tests cover:
 * - Successful execution: plan → stage → apply all succeed
 * - Fail-fast: plan exception stops pipeline
 * - Fail-fast: stage exception stops pipeline
 * - Fail-fast: apply failure (success=false) propagates
 * - Trace collection with correct keys "plan", "stage", "apply"
 * - Recursive trace structure (apply contains inject + hydrate traces)
 * - Config options propagation to plan
 * - Options propagation between steps
 * - Output structure matches InstallOutput interface
 *
 * Uses dependency injection via `executeInstallWithDeps` to avoid real operations.
 */

import { describe, it, expect, vi } from "vitest";
import { executeInstallWithDeps, type InstallDeps } from "./install.js";
import type { PlanOutput, StageOutput, ApplyOutput } from "./types.js";

// ============================================================================
// Test Helpers
// ============================================================================

/** Creates a minimal valid PlanOutput. */
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

/** Creates a minimal valid StageOutput. */
function createStageOutput(overrides: Partial<StageOutput> = {}): StageOutput {
  return {
    projectPath: "/project",
    stagingDir: ".devlink",
    staged: [],
    relinked: [],
    ...overrides,
  };
}

/** Creates a minimal valid ApplyOutput. */
function createApplyOutput(overrides: Partial<ApplyOutput> = {}): ApplyOutput {
  return {
    projectPath: "/project",
    success: true,
    trace: {
      inject: {
        projectPath: "/project",
        modified: "/project/package.json",
        injected: [],
        registry: [],
        removed: [],
        synthetic: [],
      },
      hydrate: {
        projectPath: "/project",
        success: true,
        trace: {
          "npm-install": { projectPath: "/project", exitCode: 0, args: ["install"] },
          link: { projectPath: "/project", linked: [], failed: [] },
        },
      },
    },
    ...overrides,
  };
}

/** Creates mock InstallDeps with configurable results. */
function createMockDeps(options: {
  planOutput?: PlanOutput;
  planError?: Error;
  stageOutput?: StageOutput;
  stageError?: Error;
  applyOutput?: ApplyOutput;
} = {}): InstallDeps & {
  planCalls: Array<Record<string, unknown>>;
  stageCalls: Array<Record<string, unknown>>;
  applyCalls: Array<Record<string, unknown>>;
} {
  const planCalls: Array<Record<string, unknown>> = [];
  const stageCalls: Array<Record<string, unknown>> = [];
  const applyCalls: Array<Record<string, unknown>> = [];

  return {
    planCalls,
    stageCalls,
    applyCalls,
    executePlan: async (opts) => {
      planCalls.push(opts);
      if (options.planError) throw options.planError;
      return options.planOutput ?? createPlanOutput();
    },
    executeStage: async (opts) => {
      stageCalls.push(opts);
      if (options.stageError) throw options.stageError;
      return options.stageOutput ?? createStageOutput();
    },
    executeApply: async (opts) => {
      applyCalls.push(opts);
      return options.applyOutput ?? createApplyOutput();
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("executeInstallWithDeps", () => {
  describe("successful execution", () => {
    it("executes plan → stage → apply and reports success", async () => {
      const deps = createMockDeps();
      const result = await executeInstallWithDeps({}, deps);

      expect(result.success).toBe(true);
      expect(deps.planCalls).toHaveLength(1);
      expect(deps.stageCalls).toHaveLength(1);
      expect(deps.applyCalls).toHaveLength(1);
    });

    it("collects trace with plan, stage, and apply outputs", async () => {
      const planOutput = createPlanOutput({ mode: "dev" });
      const stageOutput = createStageOutput({ staged: [{ name: "pkg", version: "1.0.0", path: "/staged/pkg" }] });
      const applyOutput = createApplyOutput({ success: true });

      const deps = createMockDeps({ planOutput, stageOutput, applyOutput });
      const result = await executeInstallWithDeps({}, deps);

      expect(result.trace["plan"]).toEqual(planOutput);
      expect(result.trace["stage"]).toEqual(stageOutput);
      expect(result.trace["apply"]).toEqual(applyOutput);
    });
  });

  describe("fail-fast on plan exception", () => {
    it("skips stage and apply when plan throws", async () => {
      const deps = createMockDeps({
        planError: new Error("Config not found"),
      });

      const result = await executeInstallWithDeps({}, deps);

      expect(result.success).toBe(false);
      expect(deps.planCalls).toHaveLength(1);
      expect(deps.stageCalls).toHaveLength(0);
      expect(deps.applyCalls).toHaveLength(0);
    });

    it("captures plan error in trace", async () => {
      const deps = createMockDeps({
        planError: new Error("Invalid mode: production"),
      });

      const result = await executeInstallWithDeps({}, deps);

      const planTrace = result.trace["plan"] as any;
      expect(planTrace.error).toBe("Invalid mode: production");
      expect(result.trace["stage"]).toBeUndefined();
      expect(result.trace["apply"]).toBeUndefined();
    });
  });

  describe("fail-fast on stage exception", () => {
    it("skips apply when stage throws", async () => {
      const deps = createMockDeps({
        stageError: new Error("Disk full"),
      });

      const result = await executeInstallWithDeps({}, deps);

      expect(result.success).toBe(false);
      expect(deps.planCalls).toHaveLength(1);
      expect(deps.stageCalls).toHaveLength(1);
      expect(deps.applyCalls).toHaveLength(0);
    });

    it("includes plan output and stage error in trace", async () => {
      const planOutput = createPlanOutput();
      const deps = createMockDeps({
        planOutput,
        stageError: new Error("Permission denied"),
      });

      const result = await executeInstallWithDeps({}, deps);

      expect(result.trace["plan"]).toEqual(planOutput);
      const stageTrace = result.trace["stage"] as any;
      expect(stageTrace.error).toBe("Permission denied");
      expect(result.trace["apply"]).toBeUndefined();
    });
  });

  describe("fail-fast on apply failure", () => {
    it("reports success=false when apply fails", async () => {
      const deps = createMockDeps({
        applyOutput: createApplyOutput({ success: false }),
      });

      const result = await executeInstallWithDeps({}, deps);

      expect(result.success).toBe(false);
      expect(deps.planCalls).toHaveLength(1);
      expect(deps.stageCalls).toHaveLength(1);
      expect(deps.applyCalls).toHaveLength(1);
    });

    it("includes all three outputs in trace when apply fails", async () => {
      const planOutput = createPlanOutput();
      const stageOutput = createStageOutput();
      const applyOutput = createApplyOutput({ success: false });

      const deps = createMockDeps({ planOutput, stageOutput, applyOutput });
      const result = await executeInstallWithDeps({}, deps);

      expect(result.trace["plan"]).toEqual(planOutput);
      expect(result.trace["stage"]).toEqual(stageOutput);
      expect(result.trace["apply"]).toEqual(applyOutput);
    });
  });

  describe("config options propagation to plan", () => {
    it("propagates all config-related options to plan", async () => {
      const deps = createMockDeps();
      await executeInstallWithDeps({
        config: "/path/to/config.mjs",
        configName: "devlink.config.mjs",
        configKey: "devlink",
        mode: "production",
        namespaces: ["global", "team"],
        packages: ["@scope/pkg-a", "@scope/pkg-b"],
        json: true,
      }, deps);

      expect(deps.planCalls[0]).toEqual({
        config: "/path/to/config.mjs",
        configName: "devlink.config.mjs",
        configKey: "devlink",
        mode: "production",
        namespaces: ["global", "team"],
        packages: ["@scope/pkg-a", "@scope/pkg-b"],
        json: true,
      });
    });

    it("passes undefined for unset options", async () => {
      const deps = createMockDeps();
      await executeInstallWithDeps({}, deps);

      expect(deps.planCalls[0]).toEqual({
        config: undefined,
        configName: undefined,
        configKey: undefined,
        mode: undefined,
        namespaces: undefined,
        packages: undefined,
        json: undefined,
      });
    });
  });

  describe("options propagation between steps", () => {
    it("passes plan projectPath to stage", async () => {
      const planOutput = createPlanOutput({ projectPath: "/plan-project" });
      const deps = createMockDeps({ planOutput });

      await executeInstallWithDeps({}, deps);

      expect(deps.stageCalls[0]).toHaveProperty("projectPath", "/plan-project");
    });

    it("passes plan projectPath to apply", async () => {
      const planOutput = createPlanOutput({ projectPath: "/plan-project" });
      const deps = createMockDeps({ planOutput });

      await executeInstallWithDeps({}, deps);

      expect(deps.applyCalls[0]).toHaveProperty("projectPath", "/plan-project");
    });

    it("propagates ignoreScripts to apply", async () => {
      const deps = createMockDeps();
      await executeInstallWithDeps({ ignoreScripts: true }, deps);

      expect(deps.applyCalls[0]).toHaveProperty("ignoreScripts", true);
    });

    it("propagates json flag to stage and apply", async () => {
      const deps = createMockDeps();
      await executeInstallWithDeps({ json: true }, deps);

      expect(deps.stageCalls[0]).toHaveProperty("json", true);
      expect(deps.applyCalls[0]).toHaveProperty("json", true);
    });
  });

  describe("recursive trace structure", () => {
    it("apply trace contains nested inject and hydrate traces", async () => {
      const applyOutput = createApplyOutput({
        success: true,
        trace: {
          inject: {
            projectPath: "/project",
            modified: "/project/package.json",
            injected: [{ name: "pkg", target: "dependencies", value: "file:.devlink/pkg" }],
            registry: [],
            removed: [],
            synthetic: [],
          },
          hydrate: {
            projectPath: "/project",
            success: true,
            trace: {
              "npm-install": { projectPath: "/project", exitCode: 0, args: ["install"] },
              link: { projectPath: "/project", linked: [{ name: "lib", path: "/lib" }], failed: [] },
            },
          },
        },
      });

      const deps = createMockDeps({ applyOutput });
      const result = await executeInstallWithDeps({}, deps);

      // Verify recursive trace structure
      const applyTrace = result.trace["apply"] as ApplyOutput;
      expect(applyTrace.trace["inject"]).toBeDefined();
      expect(applyTrace.trace["hydrate"]).toBeDefined();

      const hydrateTrace = applyTrace.trace["hydrate"];
      expect(hydrateTrace.trace["npm-install"]).toBeDefined();
      expect(hydrateTrace.trace["link"]).toBeDefined();
    });
  });

  describe("output structure", () => {
    it("produces correct InstallOutput structure", async () => {
      const deps = createMockDeps();
      const result = await executeInstallWithDeps({}, deps);

      expect(result).toHaveProperty("projectPath");
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("trace");
      expect(result.trace).toHaveProperty("plan");
      expect(result.trace).toHaveProperty("stage");
      expect(result.trace).toHaveProperty("apply");
    });

    it("includes projectPath in output", async () => {
      const deps = createMockDeps();
      const result = await executeInstallWithDeps({}, deps);

      expect(result.projectPath).toBeDefined();
      expect(typeof result.projectPath).toBe("string");
    });
  });
});
