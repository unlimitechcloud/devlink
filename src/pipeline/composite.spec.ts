/**
 * Composite Execution Utility Tests — Validates the generic executeComposite function.
 *
 * Tests cover:
 * - All steps succeed: returns success=true with complete trace
 * - Fail-fast: first failure stops execution, subsequent steps skipped
 * - Trace contains outputs of all executed steps (including failed one)
 * - Trace keys match step names
 * - Base output fields are preserved in the result
 * - Recursive nesting: composite outputs within composites nest naturally
 * - Empty steps array: returns success with empty trace
 * - Single step: works correctly with one step
 */

import { describe, it, expect } from "vitest";
import { executeComposite, type CompositeStep } from "./composite.js";

// ============================================================================
// Test Helpers
// ============================================================================

/** Creates a step that succeeds with the given output. */
function successStep(name: string, output: unknown): CompositeStep {
  return {
    name,
    execute: async () => ({ success: true, output }),
  };
}

/** Creates a step that fails with the given output. */
function failStep(name: string, output: unknown): CompositeStep {
  return {
    name,
    execute: async () => ({ success: false, output }),
  };
}

/** Creates a step that tracks whether it was called. */
function trackedStep(
  name: string,
  success: boolean,
  output: unknown
): CompositeStep & { called: boolean } {
  const step = {
    name,
    called: false,
    execute: async () => {
      step.called = true;
      return { success, output };
    },
  };
  return step;
}

// ============================================================================
// Tests
// ============================================================================

describe("executeComposite", () => {
  describe("all steps succeed", () => {
    it("returns success=true with complete trace", async () => {
      const steps: CompositeStep[] = [
        successStep("step-a", { value: "a" }),
        successStep("step-b", { value: "b" }),
        successStep("step-c", { value: "c" }),
      ];

      const result = await executeComposite<{
        projectPath: string;
        success: boolean;
        trace: Record<string, unknown>;
      }>(steps, { projectPath: "/project" });

      expect(result.success).toBe(true);
      expect(result.output.success).toBe(true);
      expect(result.output.projectPath).toBe("/project");
      expect(result.output.trace).toEqual({
        "step-a": { value: "a" },
        "step-b": { value: "b" },
        "step-c": { value: "c" },
      });
    });

    it("preserves base output fields in the result", async () => {
      const steps: CompositeStep[] = [
        successStep("only", { data: 42 }),
      ];

      const result = await executeComposite<{
        projectPath: string;
        extra: string;
        success: boolean;
        trace: Record<string, unknown>;
      }>(steps, { projectPath: "/my-project", extra: "metadata" });

      expect(result.output.projectPath).toBe("/my-project");
      expect(result.output.extra).toBe("metadata");
    });
  });

  describe("fail-fast behavior", () => {
    it("stops execution on first failure", async () => {
      const stepA = trackedStep("step-a", true, { value: "a" });
      const stepB = trackedStep("step-b", false, { error: "failed" });
      const stepC = trackedStep("step-c", true, { value: "c" });

      const result = await executeComposite<{
        success: boolean;
        trace: Record<string, unknown>;
      }>([stepA, stepB, stepC], {});

      expect(result.success).toBe(false);
      expect(stepA.called).toBe(true);
      expect(stepB.called).toBe(true);
      expect(stepC.called).toBe(false);
    });

    it("reports success=false when a step fails", async () => {
      const steps: CompositeStep[] = [
        successStep("plan", { packages: [] }),
        failStep("stage", { error: "disk full" }),
        successStep("apply", { done: true }),
      ];

      const result = await executeComposite<{
        projectPath: string;
        success: boolean;
        trace: Record<string, unknown>;
      }>(steps, { projectPath: "/project" });

      expect(result.success).toBe(false);
      expect(result.output.success).toBe(false);
    });

    it("first step failure skips all subsequent steps", async () => {
      const stepA = trackedStep("first", false, { error: "immediate failure" });
      const stepB = trackedStep("second", true, { value: "b" });
      const stepC = trackedStep("third", true, { value: "c" });

      const result = await executeComposite<{
        success: boolean;
        trace: Record<string, unknown>;
      }>([stepA, stepB, stepC], {});

      expect(result.success).toBe(false);
      expect(stepA.called).toBe(true);
      expect(stepB.called).toBe(false);
      expect(stepC.called).toBe(false);
    });
  });

  describe("trace collection", () => {
    it("trace contains outputs of all executed steps including the failed one", async () => {
      const steps: CompositeStep[] = [
        successStep("plan", { mode: "dev" }),
        failStep("stage", { error: "not found" }),
        successStep("apply", { injected: 5 }),
      ];

      const result = await executeComposite<{
        success: boolean;
        trace: Record<string, unknown>;
      }>(steps, {});

      expect(result.output.trace).toHaveProperty("plan");
      expect(result.output.trace).toHaveProperty("stage");
      expect(result.output.trace).not.toHaveProperty("apply");
      expect(result.output.trace["plan"]).toEqual({ mode: "dev" });
      expect(result.output.trace["stage"]).toEqual({ error: "not found" });
    });

    it("trace keys match step names exactly", async () => {
      const steps: CompositeStep[] = [
        successStep("npm-install", { exitCode: 0 }),
        successStep("link", { linked: [] }),
      ];

      const result = await executeComposite<{
        success: boolean;
        trace: Record<string, unknown>;
      }>(steps, {});

      expect(Object.keys(result.output.trace)).toEqual(["npm-install", "link"]);
    });
  });

  describe("recursive nesting", () => {
    it("supports composites within composites via nested trace", async () => {
      // Simulate a hydrate output (which is itself a composite)
      const hydrateOutput = {
        projectPath: "/project",
        success: true,
        trace: {
          "npm-install": { exitCode: 0, args: ["install"] },
          link: { linked: [{ name: "lib", path: "/lib" }], failed: [] },
        },
      };

      const steps: CompositeStep[] = [
        successStep("inject", { injected: [] }),
        successStep("hydrate", hydrateOutput),
      ];

      const result = await executeComposite<{
        success: boolean;
        trace: Record<string, unknown>;
      }>(steps, {});

      expect(result.success).toBe(true);
      // The hydrate output contains its own nested trace
      const hydrateTrace = result.output.trace["hydrate"] as any;
      expect(hydrateTrace.trace["npm-install"]).toEqual({ exitCode: 0, args: ["install"] });
      expect(hydrateTrace.trace["link"]).toEqual({ linked: [{ name: "lib", path: "/lib" }], failed: [] });
    });
  });

  describe("edge cases", () => {
    it("handles empty steps array — returns success with empty trace", async () => {
      const result = await executeComposite<{
        projectPath: string;
        success: boolean;
        trace: Record<string, unknown>;
      }>([], { projectPath: "/project" });

      expect(result.success).toBe(true);
      expect(result.output.success).toBe(true);
      expect(result.output.trace).toEqual({});
    });

    it("handles single step that succeeds", async () => {
      const steps: CompositeStep[] = [
        successStep("only-step", { result: "done" }),
      ];

      const result = await executeComposite<{
        success: boolean;
        trace: Record<string, unknown>;
      }>(steps, {});

      expect(result.success).toBe(true);
      expect(result.output.trace).toEqual({ "only-step": { result: "done" } });
    });

    it("handles single step that fails", async () => {
      const steps: CompositeStep[] = [
        failStep("only-step", { error: "boom" }),
      ];

      const result = await executeComposite<{
        success: boolean;
        trace: Record<string, unknown>;
      }>(steps, {});

      expect(result.success).toBe(false);
      expect(result.output.trace).toEqual({ "only-step": { error: "boom" } });
    });
  });
});
