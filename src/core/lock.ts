/**
 * Lock - File locking para serializar operaciones de escritura
 */

import fs from "fs/promises";
import { constants } from "fs";
import type { LockInfo, LockOptions, LockHandle } from "../types.js";
import {
  getStorePath,
  getLockPath,
  DEFAULT_LOCK_TIMEOUT,
  DEFAULT_LOCK_RETRY_INTERVAL,
  DEFAULT_LOCK_STALE_TIME,
} from "../constants.js";

const DEFAULT_OPTIONS: LockOptions = {
  timeout: DEFAULT_LOCK_TIMEOUT,
  retryInterval: DEFAULT_LOCK_RETRY_INTERVAL,
  stale: DEFAULT_LOCK_STALE_TIME,
};

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write lock info to file
 */
export async function writeLockInfo(lockPath: string, info: LockInfo): Promise<void> {
  await fs.writeFile(lockPath, JSON.stringify(info, null, 2));
}

/**
 * Read lock info from file
 */
export async function readLockInfo(lockPath: string): Promise<LockInfo | null> {
  try {
    const content = await fs.readFile(lockPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Check if a process is alive
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if lock is stale (process dead or too old)
 */
export async function isLockStale(
  lockPath: string,
  staleTime: number
): Promise<boolean> {
  try {
    const info = await readLockInfo(lockPath);
    if (!info) return true;

    // Check if process is still alive
    if (!isProcessAlive(info.pid)) {
      return true;
    }

    // Check if lock is too old
    const lockAge = Date.now() - new Date(info.acquired).getTime();
    if (lockAge > staleTime) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Try to acquire lock (non-blocking)
 */
async function tryAcquireLock(lockPath: string): Promise<boolean> {
  try {
    // Try to create file exclusively
    const handle = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await handle.close();
    return true;
  } catch (error: any) {
    if (error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

/**
 * Acquire exclusive lock on the store
 */
export async function acquireLock(
  options: Partial<LockOptions> = {}
): Promise<LockHandle> {
  const opts: LockOptions = { ...DEFAULT_OPTIONS, ...options };
  const storePath = getStorePath();
  const lockPath = getLockPath();

  // Ensure store directory exists
  await fs.mkdir(storePath, { recursive: true });

  const startTime = Date.now();
  let attempt = 0;
  let shownWaiting = false;

  while (true) {
    // Try to acquire lock
    const acquired = await tryAcquireLock(lockPath);

    if (acquired) {
      // Write lock info
      const info: LockInfo = {
        pid: process.pid,
        acquired: new Date().toISOString(),
        command: process.argv.slice(2).join(" "),
      };
      await writeLockInfo(lockPath, info);

      return {
        fd: 0, // Not using fd in this implementation
        release: async () => {
          try {
            await fs.unlink(lockPath);
          } catch {
            // Ignore errors on release
          }
        },
      };
    }

    // Lock is held by someone else
    const elapsed = Date.now() - startTime;

    if (elapsed >= opts.timeout) {
      const info = await readLockInfo(lockPath);
      throw new Error(
        `Timeout waiting for store lock after ${opts.timeout}ms.\n` +
        `Lock held by PID ${info?.pid || "unknown"} (${info?.command || "unknown"})\n` +
        `Acquired at: ${info?.acquired || "unknown"}\n\n` +
        `If the process is stuck, you can manually remove:\n` +
        `  rm ${lockPath}`
      );
    }

    // Check if lock is stale
    if (await isLockStale(lockPath, opts.stale)) {
      console.log("⚠️  Removing stale lock file...");
      try {
        await fs.unlink(lockPath);
      } catch {
        // Ignore, might have been removed by another process
      }
      continue;
    }

    // Show waiting message (only once)
    if (!shownWaiting) {
      const info = await readLockInfo(lockPath);
      console.log(`⏳ Store locked by PID ${info?.pid || "unknown"}, waiting...`);
      shownWaiting = true;
    }

    attempt++;
    await sleep(opts.retryInterval);
  }
}

/**
 * Execute operation with exclusive lock
 */
export async function withStoreLock<T>(
  operation: () => Promise<T>,
  options?: Partial<LockOptions>
): Promise<T> {
  const lock = await acquireLock(options);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}

/**
 * Check if store is currently locked
 */
export async function isStoreLocked(): Promise<boolean> {
  const lockPath = getLockPath();
  try {
    await fs.access(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current lock info (if locked)
 */
export async function getCurrentLockInfo(): Promise<LockInfo | null> {
  const lockPath = getLockPath();
  return readLockInfo(lockPath);
}

/**
 * Force remove lock (use with caution)
 */
export async function forceRemoveLock(): Promise<void> {
  const lockPath = getLockPath();
  try {
    await fs.unlink(lockPath);
  } catch {
    // Ignore if doesn't exist
  }
}
