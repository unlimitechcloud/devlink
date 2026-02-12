/**
 * Constants - Unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import {
  setRepoPath,
  getRepoPath,
  clearRepoPath,
  getStorePath,
  getDefaultStorePath,
  DEVLINK_REPO_ENV,
  STORE_DIR_NAME,
} from "./constants.js";

describe("Constants", () => {
  beforeEach(() => {
    clearRepoPath();
    delete process.env[DEVLINK_REPO_ENV];
  });

  afterEach(() => {
    clearRepoPath();
    delete process.env[DEVLINK_REPO_ENV];
  });

  describe("getDefaultStorePath", () => {
    it("should return path in home directory", () => {
      const result = getDefaultStorePath();
      
      if (process.platform === "win32" && process.env.LOCALAPPDATA) {
        expect(result).toBe(path.join(process.env.LOCALAPPDATA, "DevLink"));
      } else {
        expect(result).toBe(path.join(os.homedir(), STORE_DIR_NAME));
      }
    });
  });

  describe("setRepoPath / getRepoPath", () => {
    it("should set and get custom repo path", () => {
      setRepoPath("/custom/path");
      expect(getRepoPath()).toBe("/custom/path");
    });

    it("should resolve relative paths", () => {
      setRepoPath("./relative/path");
      expect(getRepoPath()).toBe(path.resolve("./relative/path"));
    });

    it("should return null when not set", () => {
      expect(getRepoPath()).toBeNull();
    });
  });

  describe("clearRepoPath", () => {
    it("should clear custom repo path", () => {
      setRepoPath("/custom/path");
      clearRepoPath();
      expect(getRepoPath()).toBeNull();
    });
  });

  describe("getStorePath", () => {
    it("should return default path when nothing is set", () => {
      const result = getStorePath();
      expect(result).toBe(getDefaultStorePath());
    });

    it("should return custom repo path when set", () => {
      setRepoPath("/custom/repo");
      expect(getStorePath()).toBe("/custom/repo");
    });

    it("should return env var path when set", () => {
      process.env[DEVLINK_REPO_ENV] = "/env/repo";
      expect(getStorePath()).toBe("/env/repo");
    });

    it("should prioritize custom repo over env var", () => {
      process.env[DEVLINK_REPO_ENV] = "/env/repo";
      setRepoPath("/custom/repo");
      expect(getStorePath()).toBe("/custom/repo");
    });

    it("should resolve relative env var paths", () => {
      process.env[DEVLINK_REPO_ENV] = "./relative/env";
      expect(getStorePath()).toBe(path.resolve("./relative/env"));
    });
  });
});
