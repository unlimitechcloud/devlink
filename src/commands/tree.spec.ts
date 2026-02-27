/**
 * Unit Tests - Tree Command
 *
 * Tests for handleTree with REAL filesystem fixtures (no mocks on scanTree).
 * The tree command calls scanTree on a real tmpdir monorepo structure,
 * then we capture console output to verify JSON and visual modes.
 * Validates: Requirements 6.1–6.5, Properties 14, 15
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { PackageManifest } from "../types.js";
import { handleTree } from "./tree.js";

describe("Tree Command (fixture-based)", () => {
  let tmpDir: string;
  let logOutput: string[];
  let errorOutput: string[];
  let originalCwd: string;
  let originalExit: typeof process.exit;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devlink-treecmd-fix-"));
    originalCwd = process.cwd();
    logOutput = [];
    errorOutput = [];

    vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logOutput.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      errorOutput.push(args.map(String).join(" "));
    });

    // Mock process.exit to throw instead of actually exiting
    originalExit = process.exit;
    process.exit = vi.fn((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Fixture builder
  // =========================================================================

  async function createPackageJson(
    dir: string,
    manifest: Partial<PackageManifest> & { workspaces?: string[] },
  ): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0", ...manifest }, null, 2),
    );
  }

  /**
   * Build a HCAMSWS-like monorepo fixture on disk:
   *
   * root/
   *   package.json (workspaces: ["packages/apps/web", "packages/cloud/*", "packages/libs/node/*", "packages/services/*"])
   *   packages/
   *     libs/node/core/          (library)
   *     cloud/core/              (infrastructure)
   *     services/web/            (sub-monorepo, workspaces: ["packages/*"])
   *       packages/connector/    (infrastructure)
   *       packages/service/      (service)
   *     services/data/           (sub-monorepo, workspaces: ["packages/*"])
   *       packages/connector/    (infrastructure)
   *       packages/service/      (service)
   *     apps/web/                (sub-monorepo, workspaces: ["packages/connector"])
   *       packages/connector/    (infrastructure)
   *       packages/app/          (app, ISOLATED)
   */
  async function buildHcamsFixture(): Promise<string> {
    const root = path.join(tmpDir, "hcamsws");

    await createPackageJson(root, {
      name: "@mastertech/hcamsws",
      workspaces: [
        "packages/apps/web",
        "packages/cloud/*",
        "packages/libs/node/*",
        "packages/services/*",
      ],
    });

    await createPackageJson(path.join(root, "packages", "libs", "node", "core"), {
      name: "@mastertech/hcamsws.libs.core",
      scripts: { build: "tsc", watch: "tsc --watch" },
    });

    await createPackageJson(path.join(root, "packages", "cloud", "core"), {
      name: "@mastertech/hcamsws.cloud.core",
      scripts: { "sst:install": "webforgeai sst install", "sst:dev": "webforgeai sst dev" },
    });

    // services/web
    await createPackageJson(path.join(root, "packages", "services", "web"), {
      name: "@mastertech/hcamsws.srv.web",
      workspaces: ["packages/*"],
      scripts: { "srv.web": "concurrently ...", build: "tsc" },
    });
    await createPackageJson(path.join(root, "packages", "services", "web", "packages", "connector"), {
      name: "connector",
      scripts: { "sst:install": "webforgeai sst install", "sst:dev": "webforgeai sst dev" },
    });
    await createPackageJson(path.join(root, "packages", "services", "web", "packages", "service"), {
      name: "service",
      scripts: { build: "tsc" },
    });

    // services/data
    await createPackageJson(path.join(root, "packages", "services", "data"), {
      name: "@mastertech/hcamsws.srv.data",
      workspaces: ["packages/*"],
      scripts: { "srv.data": "concurrently ...", build: "tsc" },
    });
    await createPackageJson(path.join(root, "packages", "services", "data", "packages", "connector"), {
      name: "connector",
      scripts: { "sst:install": "webforgeai sst install", "sst:dev": "webforgeai sst dev" },
    });
    await createPackageJson(path.join(root, "packages", "services", "data", "packages", "service"), {
      name: "service",
      scripts: { build: "tsc" },
    });

    // apps/web (restricted workspace — only connector)
    await createPackageJson(path.join(root, "packages", "apps", "web"), {
      name: "@mastertech/hcamsws.app.web",
      workspaces: ["packages/connector"],
      scripts: { "app.web": "concurrently ...", build: "vite build" },
    });
    await createPackageJson(path.join(root, "packages", "apps", "web", "packages", "connector"), {
      name: "connector",
      scripts: { "sst:install": "webforgeai sst install" },
    });
    await createPackageJson(path.join(root, "packages", "apps", "web", "packages", "app"), {
      name: "app",
      scripts: { build: "vite build", dev: "vite" },
    });

    return root;
  }

  // =========================================================================
  // JSON output — real fixture
  // =========================================================================
  describe("--json mode with real fixture", () => {
    it("outputs parseable JSON with all 5 top-level modules", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({ json: true });

      expect(logOutput).toHaveLength(1);
      const parsed = JSON.parse(logOutput[0]);
      expect(parsed.root).toBe(root);
      expect(parsed.modules).toHaveLength(5);

      const names = parsed.modules.map((m: any) => m.name).sort();
      expect(names).toEqual([
        "@mastertech/hcamsws.app.web",
        "@mastertech/hcamsws.cloud.core",
        "@mastertech/hcamsws.libs.core",
        "@mastertech/hcamsws.srv.data",
        "@mastertech/hcamsws.srv.web",
      ]);
    });

    it("JSON includes children for sub-monorepos", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({ json: true });

      const parsed = JSON.parse(logOutput[0]);
      const srvWeb = parsed.modules.find((m: any) => m.name.includes("srv.web"));
      expect(srvWeb.children).toHaveLength(2);
      expect(srvWeb.children.map((c: any) => c.name).sort()).toEqual(["connector", "service"]);
    });

    it("JSON includes installLevels (root + 3 sub-monorepos)", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({ json: true });

      const parsed = JSON.parse(logOutput[0]);
      expect(parsed.installLevels).toHaveLength(4);
      expect(parsed.installLevels[0].relativePath).toBe(".");
    });

    it("JSON includes isolated packages (apps/web/packages/app)", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({ json: true });

      const parsed = JSON.parse(logOutput[0]);
      expect(parsed.isolatedPackages).toHaveLength(1);
      expect(parsed.isolatedPackages[0]).toContain(path.join("apps", "web", "packages", "app"));
    });

    it("JSON marks isolated child with isIsolated: true", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({ json: true });

      const parsed = JSON.parse(logOutput[0]);
      const appWeb = parsed.modules.find((m: any) => m.name.includes("app.web"));
      const appChild = appWeb.children.find((c: any) => c.name === "app");
      expect(appChild.isIsolated).toBe(true);

      const connectorChild = appWeb.children.find((c: any) => c.name === "connector");
      expect(connectorChild.isIsolated).toBe(false);
    });

    it("JSON classifies modules correctly", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({ json: true });

      const parsed = JSON.parse(logOutput[0]);
      const byName = (n: string) => parsed.modules.find((m: any) => m.name.includes(n));

      expect(byName("libs.core").type).toBe("library");
      expect(byName("cloud.core").type).toBe("infrastructure");
      expect(byName("srv.web").type).toBe("service");
      expect(byName("srv.data").type).toBe("service");
      expect(byName("app.web").type).toBe("app");
    });
  });

  // =========================================================================
  // Visual output — real fixture
  // =========================================================================
  describe("visual mode with real fixture", () => {
    it("contains all module names and types", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({});

      const output = logOutput.join("\n");
      expect(output).toContain("@mastertech/hcamsws.libs.core");
      expect(output).toContain("library");
      expect(output).toContain("@mastertech/hcamsws.cloud.core");
      expect(output).toContain("infrastructure");
      expect(output).toContain("@mastertech/hcamsws.srv.web");
      expect(output).toContain("service");
      expect(output).toContain("@mastertech/hcamsws.app.web");
      expect(output).toContain("app");
    });

    it("shows children (connector, service) for sub-monorepos", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({});

      const output = logOutput.join("\n");
      expect(output).toContain("connector");
      expect(output).toContain("service");
    });

    it("shows isolated marker for apps/web/packages/app", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({});

      const output = logOutput.join("\n");
      expect(output).toContain("isolated");
    });

    it("shows correct install levels count", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({});

      const output = logOutput.join("\n");
      expect(output).toContain("Install Levels: 4");
    });

    it("shows isolated packages count", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({});

      const output = logOutput.join("\n");
      expect(output).toContain("Isolated Packages: 1");
    });

    it("shows monorepo name from root package.json", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({});

      const output = logOutput.join("\n");
      expect(output).toContain("@mastertech/hcamsws");
    });
  });

  // =========================================================================
  // --depth option — real fixture
  // =========================================================================
  describe("--depth option with real fixture", () => {
    it("depth=1 shows top-level modules without children", async () => {
      const root = await buildHcamsFixture();
      process.chdir(root);

      await handleTree({ json: true, depth: 1 });

      const parsed = JSON.parse(logOutput[0]);
      // Sub-monorepos should have no children at depth=1
      const srvWeb = parsed.modules.find((m: any) => m.name.includes("srv.web"));
      expect(srvWeb.children).toHaveLength(0);
      // Only root install level
      expect(parsed.installLevels).toHaveLength(1);
    });
  });

  // =========================================================================
  // Error cases — real filesystem
  // =========================================================================
  describe("error cases with real filesystem", () => {
    it("outputs error for directory without package.json (JSON mode)", async () => {
      const emptyDir = path.join(tmpDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });
      process.chdir(emptyDir);

      await expect(handleTree({ json: true })).rejects.toThrow("process.exit(1)");

      expect(errorOutput).toHaveLength(1);
      const parsed = JSON.parse(errorOutput[0]);
      expect(parsed.error).toContain("package.json");
    });

    it("outputs error for directory without package.json (visual mode)", async () => {
      const emptyDir = path.join(tmpDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });
      process.chdir(emptyDir);

      await expect(handleTree({})).rejects.toThrow("process.exit(1)");

      expect(errorOutput).toHaveLength(1);
      expect(errorOutput[0]).toContain("package.json");
    });

    it("outputs error for package.json without workspaces", async () => {
      const noWsDir = path.join(tmpDir, "no-ws");
      await createPackageJson(noWsDir, { name: "no-ws" });
      process.chdir(noWsDir);

      await expect(handleTree({ json: true })).rejects.toThrow("process.exit(1)");

      const parsed = JSON.parse(errorOutput[0]);
      expect(parsed.error).toContain("workspaces");
    });
  });
});
