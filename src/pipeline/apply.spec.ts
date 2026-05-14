/**
 * Apply Command Tests — Validates the apply composite execution logic.
 *
 * Tests cover:
 * - Successful execution: inject → hydrate both succeed
 * - Fail-fast: inject exception skips hydrate
 * - Fail-fast: hydrate failure (success=false) propagates
 * - Trace collection with correct keys "inject" and "hydrate"
 * - Options propagation (stage, plan, projectPath, ignoreScripts, json)
 * - Inject failure captured as error in trace
 * - Output structure matches ApplyOutput interface
 *
 * Uses dependency injection via `executeApplyWithDeps` to avoid real operations.
 */

import { describe, it, expect, vi } from "vitest";
import { executeApplyWithDeps, type ApplyDeps } from "./apply.js";
import type { InjectOutput, HydrateOutput } from "./types.js";

// ============================================================================
// Test Helpers
// ============================================================================

/** Creates a successful InjectOutput. */
function createInjectOutput(overrides: Partial<InjectOutput> = {}): InjectOutput {
  return {
    projectPath: "/project",
    modified: "/project/package.json",
    injected: [],
    registry: [],
    removed: [],
    synthetic: [],
    ...overrides,
  };
}

/** Creates a successful HydrateOutput. */
function createHydrateOutput(overrides: Partial<HydrateOutput> = {}): HydrateOutput {
  return {
    projectPath: "/project",
    success: true,
    trace: {
      "npm-install": { projectPath: "/project", exitCode: 0, args: ["install"] },
      link: { projectPath: "/project", linked: [], failed: [] },
    },
    ...overrides,
  };
}

/** Creates mock ApplyDeps with configurable results. */
function createMockDeps(options: {
  injectOutput?: InjectOutput;
  injectError?: Error;
  hydrateOutput?: HydrateOutput;
} = {}): ApplyDeps & {
  injectCalls: Array<Record<string, unknown>>;
  hydrateCalls: Array<Record<string, unknown>>;
} {
  const injectCalls: Array<Record<string, unknown>> = [];
  const hydrateCalls: Array<Record<string, unknown>> = [];

  return {
    injectCalls,
    hydrateCalls,
    executeInject: async (opts) => {
      injectCalls.push(opts);
      if (options.injectError) throw options.injectError;
      return options.injectOutput ?? createInjectOutput();
    },
    executeHydrate: async (opts) => {
      hydrateCalls.push(opts);
      return options.hydrateOutput ?? createHydrateOutput();
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("executeApplyWithDeps", () => {
  describe("successful execution", () => {
    it("executes inject then hydrate and reports success", async () => {
      const deps = createMockDeps();
      const result = await executeApplyWithDeps({ projectPath: "/project" }, deps);

      expect(result.success).toBe(true);
      expect(deps.injectCalls).toHaveLength(1);
      expect(deps.hydrateCalls).toHaveLength(1);
    });

    it("collects trace with inject and hydrate outputs", async () => {
      const injectOutput = createInjectOutput({
        injected: [{ name: "pkg-a", target: "dependencies", value: "file:.devlink/pkg-a" }],
      });
      const hydrateOutput = createHydrateOutput({ success: true });

      const deps = createMockDeps({ injectOutput, hydrateOutput });
      const result = await executeApplyWithDeps({ projectPath: "/project" }, deps);

      expect(result.trace["inject"]).toEqual(injectOutput);
      expect(result.trace["hydrate"]).toEqual(hydrateOutput);
    });
  });

  describe("fail-fast on inject exception", () => {
    it("skips hydrate when inject throws", async () => {
      const deps = createMockDeps({
        injectError: new Error("package.json not found"),
      });

      const result = await executeApplyWithDeps({ projectPath: "/project" }, deps);

      expect(result.success).toBe(false);
      expect(deps.injectCalls).toHaveLength(1);
      expect(deps.hydrateCalls).toHaveLength(0);
    });

    it("captures inject error in trace", async () => {
      const deps = createMockDeps({
        injectError: new Error("ENOENT: file not found"),
      });

      const result = await executeApplyWithDeps({ projectPath: "/project" }, deps);

      expect(result.success).toBe(false);
      const injectTrace = result.trace["inject"] as any;
      expect(injectTrace.error).toBe("ENOENT: file not found");
      expect(result.trace["hydrate"]).toBeUndefined();
    });

    it("handles non-Error exceptions gracefully", async () => {
      const deps = createMockDeps();
      // Override to throw a string
      deps.executeInject = async () => {
        throw "string error";
      };

      const result = await executeApplyWithDeps({ projectPath: "/project" }, deps);

      expect(result.success).toBe(false);
      const injectTrace = result.trace["inject"] as any;
      expect(injectTrace.error).toBe("string error");
    });
  });

  describe("fail-fast on hydrate failure", () => {
    it("reports success=false when hydrate fails", async () => {
      const deps = createMockDeps({
        hydrateOutput: createHydrateOutput({ success: false }),
      });

      const result = await executeApplyWithDeps({ projectPath: "/project" }, deps);

      expect(result.success).toBe(false);
      expect(deps.injectCalls).toHaveLength(1);
      expect(deps.hydrateCalls).toHaveLength(1);
    });

    it("includes both inject and hydrate in trace when hydrate fails", async () => {
      const injectOutput = createInjectOutput();
      const hydrateOutput = createHydrateOutput({ success: false });

      const deps = createMockDeps({ injectOutput, hydrateOutput });
      const result = await executeApplyWithDeps({ projectPath: "/project" }, deps);

      expect(result.trace["inject"]).toEqual(injectOutput);
      expect(result.trace["hydrate"]).toEqual(hydrateOutput);
    });
  });

  describe("options propagation", () => {
    it("propagates stage and plan to inject", async () => {
      const deps = createMockDeps();
      await executeApplyWithDeps({
        stage: "/tmp/stage.json",
        plan: "/tmp/plan.json",
        projectPath: "/project",
      }, deps);

      expect(deps.injectCalls[0]).toHaveProperty("stage", "/tmp/stage.json");
      expect(deps.injectCalls[0]).toHaveProperty("plan", "/tmp/plan.json");
    });

    it("propagates plan and ignoreScripts to hydrate", async () => {
      const deps = createMockDeps();
      await executeApplyWithDeps({
        plan: "/tmp/plan.json",
        ignoreScripts: true,
        projectPath: "/project",
      }, deps);

      expect(deps.hydrateCalls[0]).toHaveProperty("plan", "/tmp/plan.json");
      expect(deps.hydrateCalls[0]).toHaveProperty("ignoreScripts", true);
    });

    it("propagates projectPath to both sub-commands", async () => {
      const deps = createMockDeps();
      await executeApplyWithDeps({ projectPath: "/custom/path" }, deps);

      expect(deps.injectCalls[0]).toHaveProperty("projectPath", "/custom/path");
      expect(deps.hydrateCalls[0]).toHaveProperty("projectPath", "/custom/path");
    });

    it("propagates json flag to both sub-commands", async () => {
      const deps = createMockDeps();
      await executeApplyWithDeps({ json: true, projectPath: "/project" }, deps);

      expect(deps.injectCalls[0]).toHaveProperty("json", true);
      expect(deps.hydrateCalls[0]).toHaveProperty("json", true);
    });
  });

  describe("output structure", () => {
    it("produces correct ApplyOutput structure", async () => {
      const deps = createMockDeps();
      const result = await executeApplyWithDeps({ projectPath: "/project" }, deps);

      expect(result).toHaveProperty("projectPath", "/project");
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("trace");
      expect(result.trace).toHaveProperty("inject");
      expect(result.trace).toHaveProperty("hydrate");
    });

    it("hydrate trace is recursive — contains its own sub-traces", async () => {
      const hydrateOutput = createHydrateOutput({
        success: true,
        trace: {
          "npm-install": { projectPath: "/project", exitCode: 0, args: ["install"] },
          link: { projectPath: "/project", linked: [{ name: "lib", path: "/lib" }], failed: [] },
        },
      });

      const deps = createMockDeps({ hydrateOutput });
      const result = await executeApplyWithDeps({ projectPath: "/project" }, deps);

      const hydrateTrace = result.trace["hydrate"] as HydrateOutput;
      expect(hydrateTrace.trace["npm-install"]).toBeDefined();
      expect(hydrateTrace.trace["link"]).toBeDefined();
    });
  });
});
