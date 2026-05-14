/**
 * Fixture Utilities — Decompression and temp directory management for CLI integration tests.
 *
 * Provides functions to decompress tar.gz fixture archives to unique temp directories
 * and clean them up after tests. Each call creates an isolated directory to support
 * concurrent test execution without interference.
 */

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../../fixtures");
const PUBLISHERS_DIR = join(FIXTURES_DIR, "publishers");
const CONSUMERS_DIR = join(FIXTURES_DIR, "consumers");

/**
 * Decompress a publisher fixture to a unique temp directory.
 *
 * @param name - Fixture name without extension (e.g., "simple-lib")
 * @returns Absolute path to the decompressed fixture directory
 */
export async function decompressPublisher(name: string): Promise<string> {
  const archivePath = join(PUBLISHERS_DIR, `${name}.tar.gz`);
  const tempDir = await mkdtemp(join(tmpdir(), `devlink-pub-${name}-`));
  execSync(`tar -xzf "${archivePath}" -C "${tempDir}"`, { stdio: "pipe" });
  return tempDir;
}

/**
 * Decompress a consumer fixture to a unique temp directory.
 *
 * @param name - Fixture name without extension (e.g., "consumer-modes")
 * @returns Absolute path to the decompressed fixture directory
 */
export async function decompressConsumer(name: string): Promise<string> {
  const archivePath = join(CONSUMERS_DIR, `${name}.tar.gz`);
  const tempDir = await mkdtemp(join(tmpdir(), `devlink-con-${name}-`));
  execSync(`tar -xzf "${archivePath}" -C "${tempDir}"`, { stdio: "pipe" });
  return tempDir;
}

/**
 * Create a fresh temp directory for use as a store (--repo target).
 *
 * @returns Absolute path to the empty temp store directory
 */
export async function createTempStore(): Promise<string> {
  return mkdtemp(join(tmpdir(), "devlink-store-"));
}

/**
 * Remove a temp directory and all its contents. Idempotent — does not throw
 * if the directory doesn't exist.
 */
export async function cleanupTemp(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}
