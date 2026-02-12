/**
 * Lock - Unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  acquireLock,
  writeLockInfo,
  readLockInfo,
  isLockStale,
  withStoreLock,
  isStoreLocked,
  getCurrentLockInfo,
  forceRemoveLock,
} from "./lock.js";
import type { LockInfo } from "../types.js";

// Mock the constants module to use temp directory
const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-test-" + Date.now());

vi.mock("../constants.js", () => ({
  getStorePath: () => TEST_STORE_PATH,
  getLockPath: () => path.join(TEST_STORE_PATH, ".lock"),
  DEFAULT_LOCK_TIMEOUT: 5000,
  DEFAULT_LOCK_RETRY_INTERVAL: 50,
  DEFAULT_LOCK_STALE_TIME: 2000,
}));

describe("Lock", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
  });

  describe("writeLockInfo / readLockInfo", () => {
    it("should write and read lock info", async () => {
      const lockPath = path.join(TEST_STORE_PATH, ".lock");
      const info: LockInfo = {
        pid: 12345,
        acquired: "2026-02-12T10:00:00Z",
        command: "publish",
      };

      await writeLockInfo(lockPath, info);
      const read = await readLockInfo(lockPath);

      expect(read).toEqual(info);
    });

    it("should return null for non-existent lock file", async () => {
      const lockPath = path.join(TEST_STORE_PATH, "nonexistent.lock");
      const read = await readLockInfo(lockPath);
      expect(read).toBeNull();
    });
  });

  describe("isLockStale", () => {
    it("should return true for non-existent lock", async () => {
      const lockPath = path.join(TEST_STORE_PATH, "nonexistent.lock");
      const stale = await isLockStale(lockPath, 10000);
      expect(stale).toBe(true);
    });

    it("should return true for dead process", async () => {
      const lockPath = path.join(TEST_STORE_PATH, ".lock");
      const info: LockInfo = {
        pid: 999999999, // Non-existent PID
        acquired: new Date().toISOString(),
        command: "test",
      };
      await writeLockInfo(lockPath, info);

      const stale = await isLockStale(lockPath, 10000);
      expect(stale).toBe(true);
    });

    it("should return false for current process", async () => {
      const lockPath = path.join(TEST_STORE_PATH, ".lock");
      const info: LockInfo = {
        pid: process.pid,
        acquired: new Date().toISOString(),
        command: "test",
      };
      await writeLockInfo(lockPath, info);

      const stale = await isLockStale(lockPath, 10000);
      expect(stale).toBe(false);
    });

    it("should return true for old lock", async () => {
      const lockPath = path.join(TEST_STORE_PATH, ".lock");
      const oldDate = new Date(Date.now() - 20000).toISOString();
      const info: LockInfo = {
        pid: process.pid,
        acquired: oldDate,
        command: "test",
      };
      await writeLockInfo(lockPath, info);

      const stale = await isLockStale(lockPath, 1000);
      expect(stale).toBe(true);
    });
  });

  describe("acquireLock", () => {
    it("should acquire lock successfully", async () => {
      const lock = await acquireLock();
      
      expect(lock).toBeDefined();
      expect(typeof lock.release).toBe("function");
      
      // Verify lock file exists
      const locked = await isStoreLocked();
      expect(locked).toBe(true);
      
      await lock.release();
    });

    it("should release lock properly", async () => {
      const lock = await acquireLock();
      await lock.release();
      
      const locked = await isStoreLocked();
      expect(locked).toBe(false);
    });

    it("should write correct lock info", async () => {
      const lock = await acquireLock();
      
      const info = await getCurrentLockInfo();
      expect(info).toBeDefined();
      expect(info?.pid).toBe(process.pid);
      expect(info?.acquired).toBeDefined();
      
      await lock.release();
    });
  });

  describe("withStoreLock", () => {
    it("should execute operation with lock", async () => {
      let executed = false;
      
      await withStoreLock(async () => {
        executed = true;
        const locked = await isStoreLocked();
        expect(locked).toBe(true);
      });
      
      expect(executed).toBe(true);
      
      // Lock should be released
      const locked = await isStoreLocked();
      expect(locked).toBe(false);
    });

    it("should release lock on error", async () => {
      await expect(
        withStoreLock(async () => {
          throw new Error("Test error");
        })
      ).rejects.toThrow("Test error");
      
      // Lock should be released
      const locked = await isStoreLocked();
      expect(locked).toBe(false);
    });

    it("should return operation result", async () => {
      const result = await withStoreLock(async () => {
        return 42;
      });
      
      expect(result).toBe(42);
    });
  });

  describe("isStoreLocked", () => {
    it("should return false when not locked", async () => {
      const locked = await isStoreLocked();
      expect(locked).toBe(false);
    });

    it("should return true when locked", async () => {
      const lock = await acquireLock();
      
      const locked = await isStoreLocked();
      expect(locked).toBe(true);
      
      await lock.release();
    });
  });

  describe("forceRemoveLock", () => {
    it("should remove lock file", async () => {
      const lock = await acquireLock();
      
      await forceRemoveLock();
      
      const locked = await isStoreLocked();
      expect(locked).toBe(false);
    });

    it("should not throw if lock doesn't exist", async () => {
      await expect(forceRemoveLock()).resolves.not.toThrow();
    });
  });
});
