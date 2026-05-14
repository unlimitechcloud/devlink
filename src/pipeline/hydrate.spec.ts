/**
 * Hydrate Command Tests — Validates the hydrate composite execution logic.
 *
 * Tests cover:
 * - Successful execution: npm-install → link both succeed
 * - Fail-fast: npm-install failure (exitCode !== 0) skips link
 * - Trace collection with correct keys "npm-install" and "link"
 * - Project path propagation to sub-commands
 * - Options propagation (ignoreScripts, plan, json)
 * - Link always succeeds from composite perspective
 * - Output structure matches HydrateOutput interface
 *
 * Uses dependency injection via `executeHydrateWithDeps` to avoid real npm processes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeHydrateWithDeps, type HydrateDeps } from "./hydrate.js";
import type { NpmInstallOutput, LinkOutput } from "./types.js";

// ============================================================================
// Test Helpers
// ============================================================================

/** Creates a successful NpmInstallOutput. */
function createNpmInstallOutput(overrides: Partial<NpmInstallOutput> = {}): NpmInstallOutput {
  return {
    projectPath: "/project",
    exitCode: 0,
    args: ["install", "--no-audit", "--legacy-peer-deps"],
    ...overrides,
  };
}

/** Creates a successful LinkOutput. */
function createLinkOutput(overrides: Partial<LinkOutput> = {}): LinkOutput {
  return {
    projectPath: "/project",
    linked: [],
    failed: [],
    ...overrides,
  };
}

/** Creates mock HydrateDeps with configurable results. */
function createMockDeps(options: {
  npmInstallOutput?: NpmInstallOutput;
  linkOutput?: LinkOutput;
} = {}): HydrateDeps & {
  npmInstallCalls: Array<Record<string, unknown>>;
  linkCalls: Array<Record<string, unknown>>;
} {
  const npmInstallCalls: Array<Record<string, unknown>> = [];
  const linkCalls: Array<Record<string, unknown>> = [];

  return {
    npmInstallCalls,
    linkCalls,
    executeNpmInstall: async (opts) => {
      npmInstallCalls.push(opts);
      return options.npmInstallOutput ?? createNpmInstallOutput();
    },
    executeLink: async (opts) => {
      linkCalls.push(opts);
      return options.linkOutput ?? createLinkOutput();
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("executeHydrateWithDeps", () => {
  describe("successful execution", () => {
    it("executes npm-install then link and reports success", async () => {
      const deps = createMockDeps({
        npmInstallOutput: createNpmInstallOutput({ exitCode: 0 }),
        linkOutput: createLinkOutput({ linked: [{ name: "lib", path: "/libs/lib" }] }),
      });

      const result = await executeHydrateWithDeps({ projectPath: "/project" }, deps);

      expect(result.success).toBe(true);
      expect(deps.npmInstallCalls).toHaveLength(1);
      expect(deps.linkCalls).toHaveLength(1);
    });

    it("collects trace with npm-install and link outputs", async () => {
      const npmOutput = createNpmInstallOutput({ exitCode: 0, args: ["install", "--no-audit"] });
      const linkOutput = createLinkOutput({
        linked: [{ name: "@scope/lib", path: "/libs/scoped" }],
        failed: [],
      });

      const deps = createMockDeps({ npmInstallOutput: npmOutput, linkOutput });
      const result = await executeHydrateWithDeps({ projectPath: "/project" }, deps);

      expect(result.trace["npm-install"]).toEqual(npmOutput);
      expect(result.trace["link"]).toEqual(linkOutput);
    });
  });

  describe("fail-fast on npm-install failure", () => {
    it("skips link when npm-install exits with non-zero code", async () => {
      const deps = createMockDeps({
        npmInstallOutput: createNpmInstallOutput({ exitCode: 1 }),
      });

      const result = await executeHydrateWithDeps({ projectPath: "/project" }, deps);

      expect(result.success).toBe(false);
      expect(deps.npmInstallCalls).toHaveLength(1);
      expect(deps.linkCalls).toHaveLength(0);
    });

    it("includes npm-install output in trace even on failure", async () => {
      const npmOutput = createNpmInstallOutput({ exitCode: 127 });
      const deps = createMockDeps({ npmInstallOutput: npmOutput });

      const result = await executeHydrateWithDeps({ projectPath: "/project" }, deps);

      expect(result.success).toBe(false);
      expect(result.trace["npm-install"]).toEqual(npmOutput);
      expect(result.trace["link"]).toBeUndefined();
    });

    it("reports success=false for any non-zero exit code", async () => {
      for (const exitCode of [1, 2, 127, 255]) {
        const deps = createMockDeps({
          npmInstallOutput: createNpmInstallOutput({ exitCode }),
        });

        const result = await executeHydrateWithDeps({ projectPath: "/project" }, deps);
        expect(result.success).toBe(false);
      }
    });
  });

  describe("options propagation", () => {
    it("propagates projectPath to both sub-commands", async () => {
      const deps = createMockDeps();
      await executeHydrateWithDeps({ projectPath: "/custom/path" }, deps);

      expect(deps.npmInstallCalls[0]).toHaveProperty("projectPath", "/custom/path");
      expect(deps.linkCalls[0]).toHaveProperty("projectPath", "/custom/path");
    });

    it("propagates ignoreScripts to npm-install", async () => {
      const deps = createMockDeps();
      await executeHydrateWithDeps({ ignoreScripts: true, projectPath: "/project" }, deps);

      expect(deps.npmInstallCalls[0]).toHaveProperty("ignoreScripts", true);
    });

    it("propagates plan to link", async () => {
      const deps = createMockDeps();
      await executeHydrateWithDeps({ plan: "/tmp/plan.json", projectPath: "/project" }, deps);

      expect(deps.linkCalls[0]).toHaveProperty("plan", "/tmp/plan.json");
    });

    it("propagates json flag to both sub-commands", async () => {
      const deps = createMockDeps();
      await executeHydrateWithDeps({ json: true, projectPath: "/project" }, deps);

      expect(deps.npmInstallCalls[0]).toHaveProperty("json", true);
      expect(deps.linkCalls[0]).toHaveProperty("json", true);
    });
  });

  describe("link always succeeds from composite perspective", () => {
    it("reports success=true even when link has failed entries", async () => {
      const deps = createMockDeps({
        npmInstallOutput: createNpmInstallOutput({ exitCode: 0 }),
        linkOutput: createLinkOutput({
          linked: [],
          failed: [{ name: "broken-lib", path: "/libs/broken", exitCode: 1 }],
        }),
      });

      const result = await executeHydrateWithDeps({ projectPath: "/project" }, deps);

      // Link handles its own failures internally — composite still succeeds
      expect(result.success).toBe(true);
      expect((result.trace["link"] as LinkOutput).failed).toHaveLength(1);
    });
  });

  describe("output structure", () => {
    it("produces correct HydrateOutput structure", async () => {
      const deps = createMockDeps();
      const result = await executeHydrateWithDeps({ projectPath: "/project" }, deps);

      expect(result).toHaveProperty("projectPath", "/project");
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("trace");
      expect(result.trace).toHaveProperty("npm-install");
      expect(result.trace).toHaveProperty("link");
    });

    it("uses provided projectPath in output", async () => {
      const deps = createMockDeps();
      const result = await executeHydrateWithDeps({ projectPath: "/my-project" }, deps);

      expect(result.projectPath).toBe("/my-project");
    });
  });
});
