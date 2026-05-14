/**
 * OutputRouter Tests — Verifies output routing behavior in both JSON and human modes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOutputRouter } from "./output-router.js";

describe("createOutputRouter", () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  describe("jsonMode = true", () => {
    it("json() writes serialized JSON to stdout", () => {
      const router = createOutputRouter(true);
      const data = { success: true, packages: ["a", "b"] };

      router.json(data);

      expect(stdoutWrite).toHaveBeenCalledWith(JSON.stringify(data) + "\n");
    });

    it("human() is a no-op (does not write to stdout)", () => {
      const router = createOutputRouter(true);

      router.human("Installing packages...");

      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it("log() writes to stderr", () => {
      const router = createOutputRouter(true);

      router.log("debug: resolving config");

      expect(stderrWrite).toHaveBeenCalledWith("debug: resolving config\n");
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('subprocessStdio() returns "pipe"', () => {
      const router = createOutputRouter(true);

      expect(router.subprocessStdio()).toBe("pipe");
    });
  });

  describe("jsonMode = false", () => {
    it("json() is a no-op (does not write to stdout)", () => {
      const router = createOutputRouter(false);

      router.json({ some: "data" });

      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it("human() writes message to stdout", () => {
      const router = createOutputRouter(false);

      router.human("✓ Installed 5 packages");

      expect(stdoutWrite).toHaveBeenCalledWith("✓ Installed 5 packages\n");
    });

    it("log() writes to stderr", () => {
      const router = createOutputRouter(false);

      router.log("warning: package not found");

      expect(stderrWrite).toHaveBeenCalledWith("warning: package not found\n");
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('subprocessStdio() returns "inherit"', () => {
      const router = createOutputRouter(false);

      expect(router.subprocessStdio()).toBe("inherit");
    });
  });

  describe("log() always writes to stderr regardless of mode", () => {
    it("writes to stderr in json mode", () => {
      const router = createOutputRouter(true);
      router.log("message");
      expect(stderrWrite).toHaveBeenCalledWith("message\n");
    });

    it("writes to stderr in human mode", () => {
      const router = createOutputRouter(false);
      router.log("message");
      expect(stderrWrite).toHaveBeenCalledWith("message\n");
    });
  });
});
