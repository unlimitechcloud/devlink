/**
 * NpmInstall Command Tests — Validates the npm-install execution logic.
 *
 * Tests cover:
 * - Spawning npm with correct base arguments (--no-audit --legacy-peer-deps)
 * - Adding --ignore-scripts when ignoreScripts option is set
 * - Routing subprocess stdio to stderr when --json is active (pipe mode)
 * - Using inherited stdio when --json is not active
 * - Reporting exit code in structured output without throwing
 * - Handling non-zero exit codes gracefully
 * - Handling spawn errors gracefully
 * - Including args array in output
 * - Using projectPath from options or falling back to cwd
 *
 * Uses dependency injection via `executeNpmInstallWithDeps` to avoid spawning
 * real npm processes during testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { Readable } from "stream";
import { executeNpmInstallWithDeps, type NpmInstallDeps } from "./npm-install.js";
import type { ChildProcess } from "child_process";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock ChildProcess that emits close with the given exit code.
 */
function createMockChild(exitCode: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new Readable({ read() {} }) as any;
  child.stderr = new Readable({ read() {} }) as any;
  child.stdin = null as any;
  child.pid = 12345;
  child.killed = false;
  child.connected = false;
  child.exitCode = null;
  child.signalCode = null;
  child.spawnargs = [];
  child.spawnfile = "";

  // Emit close on next tick to simulate async process completion
  process.nextTick(() => {
    child.emit("close", exitCode);
  });

  return child;
}

/**
 * Creates a mock ChildProcess with inherited stdio (no stdout/stderr streams).
 */
function createMockChildInherited(exitCode: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = null as any;
  child.stderr = null as any;
  child.stdin = null as any;
  child.pid = 12345;
  child.killed = false;
  child.connected = false;
  child.exitCode = null;
  child.signalCode = null;
  child.spawnargs = [];
  child.spawnfile = "";

  process.nextTick(() => {
    child.emit("close", exitCode);
  });

  return child;
}

/**
 * Creates a mock ChildProcess that emits an error event.
 */
function createMockChildError(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new Readable({ read() {} }) as any;
  child.stderr = new Readable({ read() {} }) as any;
  child.stdin = null as any;
  child.pid = undefined;
  child.killed = false;
  child.connected = false;
  child.exitCode = null;
  child.signalCode = null;
  child.spawnargs = [];
  child.spawnfile = "";

  process.nextTick(() => {
    child.emit("error", new Error("spawn ENOENT"));
  });

  return child;
}

/**
 * Creates mock NpmInstallDeps that tracks spawn calls.
 */
function createMockDeps(child: ChildProcess) {
  const calls: Array<{
    command: string;
    args: string[];
    options: { cwd: string; stdio: "inherit" | ["pipe", "pipe", "pipe"] };
  }> = [];

  const deps: NpmInstallDeps = {
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
  };

  return { deps, calls };
}

// ============================================================================
// Tests
// ============================================================================

describe("executeNpmInstallWithDeps", () => {
  let originalCwd: typeof process.cwd;

  beforeEach(() => {
    originalCwd = process.cwd;
    process.cwd = () => "/default/project";
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  describe("base arguments", () => {
    it("spawns npm with install --no-audit --legacy-peer-deps", async () => {
      const child = createMockChildInherited(0);
      const { deps, calls } = createMockDeps(child);

      await executeNpmInstallWithDeps({ projectPath: "/my-project" }, deps);

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe("npm");
      expect(calls[0].args).toEqual(["install", "--no-audit", "--legacy-peer-deps"]);
    });
  });

  describe("--ignore-scripts option", () => {
    it("adds --ignore-scripts when ignoreScripts is true", async () => {
      const child = createMockChildInherited(0);
      const { deps, calls } = createMockDeps(child);

      await executeNpmInstallWithDeps(
        { projectPath: "/my-project", ignoreScripts: true },
        deps
      );

      expect(calls[0].args).toEqual([
        "install",
        "--no-audit",
        "--legacy-peer-deps",
        "--ignore-scripts",
      ]);
    });

    it("does not add --ignore-scripts when ignoreScripts is false", async () => {
      const child = createMockChildInherited(0);
      const { deps, calls } = createMockDeps(child);

      await executeNpmInstallWithDeps(
        { projectPath: "/my-project", ignoreScripts: false },
        deps
      );

      expect(calls[0].args).toEqual(["install", "--no-audit", "--legacy-peer-deps"]);
    });

    it("does not add --ignore-scripts when ignoreScripts is undefined", async () => {
      const child = createMockChildInherited(0);
      const { deps, calls } = createMockDeps(child);

      await executeNpmInstallWithDeps({ projectPath: "/my-project" }, deps);

      expect(calls[0].args).toEqual(["install", "--no-audit", "--legacy-peer-deps"]);
    });
  });

  describe("stdio routing", () => {
    it("uses pipe stdio when --json is active", async () => {
      const child = createMockChild(0);
      const { deps, calls } = createMockDeps(child);

      await executeNpmInstallWithDeps(
        { projectPath: "/my-project", json: true },
        deps
      );

      expect(calls[0].options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    });

    it("uses inherit stdio when --json is not active", async () => {
      const child = createMockChildInherited(0);
      const { deps, calls } = createMockDeps(child);

      await executeNpmInstallWithDeps(
        { projectPath: "/my-project", json: false },
        deps
      );

      expect(calls[0].options.stdio).toBe("inherit");
    });

    it("uses inherit stdio when json option is undefined", async () => {
      const child = createMockChildInherited(0);
      const { deps, calls } = createMockDeps(child);

      await executeNpmInstallWithDeps({ projectPath: "/my-project" }, deps);

      expect(calls[0].options.stdio).toBe("inherit");
    });

    it("routes piped stdout to stderr when --json is active", async () => {
      const child = new EventEmitter() as ChildProcess;
      child.stdout = new Readable({ read() {} }) as any;
      child.stderr = new Readable({ read() {} }) as any;
      child.stdin = null as any;
      child.pid = 12345;
      child.killed = false;
      child.connected = false;
      child.exitCode = null;
      child.signalCode = null;
      child.spawnargs = [];
      child.spawnfile = "";

      const stderrWrites: string[] = [];
      const originalWrite = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        stderrWrites.push(chunk.toString());
        return true;
      }) as any;

      const { deps } = createMockDeps(child);
      const resultPromise = executeNpmInstallWithDeps(
        { projectPath: "/my-project", json: true },
        deps
      );

      // Simulate npm writing to stdout
      process.nextTick(() => {
        child.stdout!.emit("data", Buffer.from("npm output line\n"));
        child.stderr!.emit("data", Buffer.from("npm warn something\n"));
        child.emit("close", 0);
      });

      await resultPromise;

      process.stderr.write = originalWrite;

      expect(stderrWrites).toContain("npm output line\n");
      expect(stderrWrites).toContain("npm warn something\n");
    });
  });

  describe("exit code reporting", () => {
    it("reports exit code 0 on success", async () => {
      const child = createMockChildInherited(0);
      const { deps } = createMockDeps(child);

      const result = await executeNpmInstallWithDeps(
        { projectPath: "/my-project" },
        deps
      );

      expect(result.exitCode).toBe(0);
    });

    it("reports non-zero exit code without throwing", async () => {
      const child = createMockChildInherited(1);
      const { deps } = createMockDeps(child);

      const result = await executeNpmInstallWithDeps(
        { projectPath: "/my-project" },
        deps
      );

      expect(result.exitCode).toBe(1);
    });

    it("reports exit code 127 (command not found) without throwing", async () => {
      const child = createMockChildInherited(127);
      const { deps } = createMockDeps(child);

      const result = await executeNpmInstallWithDeps(
        { projectPath: "/my-project" },
        deps
      );

      expect(result.exitCode).toBe(127);
    });

    it("reports exit code 1 on spawn error", async () => {
      const child = createMockChildError();
      const { deps } = createMockDeps(child);

      const result = await executeNpmInstallWithDeps(
        { projectPath: "/my-project" },
        deps
      );

      expect(result.exitCode).toBe(1);
    });

    it("reports exit code 1 when close event has null code", async () => {
      const child = new EventEmitter() as ChildProcess;
      child.stdout = null as any;
      child.stderr = null as any;
      child.stdin = null as any;
      child.pid = 12345;
      child.killed = false;
      child.connected = false;
      child.exitCode = null;
      child.signalCode = null;
      child.spawnargs = [];
      child.spawnfile = "";

      process.nextTick(() => {
        child.emit("close", null);
      });

      const { deps } = createMockDeps(child);
      const result = await executeNpmInstallWithDeps(
        { projectPath: "/my-project" },
        deps
      );

      expect(result.exitCode).toBe(1);
    });
  });

  describe("output structure", () => {
    it("includes projectPath in output", async () => {
      const child = createMockChildInherited(0);
      const { deps } = createMockDeps(child);

      const result = await executeNpmInstallWithDeps(
        { projectPath: "/my-project" },
        deps
      );

      expect(result.projectPath).toBe("/my-project");
    });

    it("includes args array in output", async () => {
      const child = createMockChildInherited(0);
      const { deps } = createMockDeps(child);

      const result = await executeNpmInstallWithDeps(
        { projectPath: "/my-project", ignoreScripts: true },
        deps
      );

      expect(result.args).toEqual([
        "install",
        "--no-audit",
        "--legacy-peer-deps",
        "--ignore-scripts",
      ]);
    });

    it("returns a valid NpmInstallOutput shape", async () => {
      const child = createMockChildInherited(0);
      const { deps } = createMockDeps(child);

      const result = await executeNpmInstallWithDeps(
        { projectPath: "/my-project" },
        deps
      );

      expect(result).toHaveProperty("projectPath");
      expect(result).toHaveProperty("exitCode");
      expect(result).toHaveProperty("args");
      expect(typeof result.projectPath).toBe("string");
      expect(typeof result.exitCode).toBe("number");
      expect(Array.isArray(result.args)).toBe(true);
    });
  });

  describe("project path resolution", () => {
    it("uses projectPath from options when provided", async () => {
      const child = createMockChildInherited(0);
      const { deps, calls } = createMockDeps(child);

      const result = await executeNpmInstallWithDeps(
        { projectPath: "/custom/path" },
        deps
      );

      expect(calls[0].options.cwd).toBe("/custom/path");
      expect(result.projectPath).toBe("/custom/path");
    });

    it("falls back to process.cwd() when projectPath is not provided", async () => {
      const child = createMockChildInherited(0);
      const { deps, calls } = createMockDeps(child);

      const result = await executeNpmInstallWithDeps({}, deps);

      expect(calls[0].options.cwd).toBe("/default/project");
      expect(result.projectPath).toBe("/default/project");
    });
  });
});
