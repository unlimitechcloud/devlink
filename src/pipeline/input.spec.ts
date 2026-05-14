/**
 * Tests for readPipelineInput — validates file reading, stdin reading,
 * and error handling for missing files and invalid JSON.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { readPipelineInput } from "./input.js";

describe("readPipelineInput", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devlink-input-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("reading from file", () => {
    it("parses valid JSON from a file", async () => {
      const data = { version: "1", mode: "dev", packages: [] };
      const filePath = path.join(tmpDir, "plan.json");
      await fs.writeFile(filePath, JSON.stringify(data));

      const result = await readPipelineInput<typeof data>(filePath);

      expect(result).toEqual(data);
    });

    it("handles nested JSON objects", async () => {
      const data = {
        projectPath: "/tmp/project",
        staged: [{ name: "@webforgeai/sdk.core", version: "1.0.0", path: ".devlink/@webforgeai/sdk.core" }],
        relinked: [],
      };
      const filePath = path.join(tmpDir, "stage.json");
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));

      const result = await readPipelineInput<typeof data>(filePath);

      expect(result).toEqual(data);
    });

    it("throws descriptive error when file does not exist", async () => {
      const filePath = path.join(tmpDir, "nonexistent.json");

      await expect(readPipelineInput(filePath)).rejects.toThrow(
        /Pipeline input file not found/
      );
      await expect(readPipelineInput(filePath)).rejects.toThrow(filePath);
    });

    it("throws descriptive error when file contains invalid JSON", async () => {
      const filePath = path.join(tmpDir, "bad.json");
      await fs.writeFile(filePath, "{ not valid json }}}");

      await expect(readPipelineInput(filePath)).rejects.toThrow(
        /Invalid JSON in pipeline input/
      );
      await expect(readPipelineInput(filePath)).rejects.toThrow(filePath);
    });

    it("throws descriptive error when file is empty", async () => {
      const filePath = path.join(tmpDir, "empty.json");
      await fs.writeFile(filePath, "");

      await expect(readPipelineInput(filePath)).rejects.toThrow(
        /Pipeline input is empty/
      );
    });

    it("throws descriptive error when file contains only whitespace", async () => {
      const filePath = path.join(tmpDir, "whitespace.json");
      await fs.writeFile(filePath, "   \n\t  \n  ");

      await expect(readPipelineInput(filePath)).rejects.toThrow(
        /Pipeline input is empty/
      );
    });
  });

  describe("reading from stdin", () => {
    it("throws when stdin is a TTY (no piped data)", async () => {
      // When stdin.isTTY is true, it means no data is piped
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

      try {
        await expect(readPipelineInput()).rejects.toThrow(
          /No pipeline input provided/
        );
      } finally {
        Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
      }
    });
  });
});
