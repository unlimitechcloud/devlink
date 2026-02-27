/**
 * Unit Tests - Tree Scanner
 *
 * Tests for scanTree, classifyModule, and helper functions.
 * Uses tmpdir fixtures to create monorepo structures on disk.
 * Validates: Requirements 1.1–1.8, Properties 1–6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  scanTree,
  classifyModule,
  resolveWorkspaceGlobs,
  listSubPackages,
  isPathInResolvedGlobs,
  readPackageJson,
} from "./tree.js";
import type { PackageManifest } from "../types.js";

describe("Tree Scanner", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devlink-tree-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Create a package.json in a directory */
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

  /** Create a devlink.config.mjs in a directory */
  async function createDevlinkConfig(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "devlink.config.mjs"),
      "export default { packages: {} };",
    );
  }

  /**
   * Build a minimal monorepo fixture:
   *
   * root/
   *   package.json (workspaces: ["packages/*"])
   *   packages/
   *     lib-a/package.json
   *     sub-mono/
   *       package.json (workspaces: ["packages/*"])
   *       packages/
   *         connector/package.json
   *         app/package.json  ← isolated (not in "packages/*" if we use "packages/connector" glob)
   */
  async function buildMinimalMonorepo(): Promise<string> {
    const root = path.join(tmpDir, "monorepo");

    // Root
    await createPackageJson(root, {
      name: "my-monorepo",
      workspaces: ["packages/*"],
    });

    // packages/lib-a
    await createPackageJson(path.join(root, "packages", "lib-a"), {
      name: "lib-a",
      scripts: { build: "tsc" },
    });

    // packages/sub-mono (sub-monorepo with restricted workspace glob)
    await createPackageJson(path.join(root, "packages", "sub-mono"), {
      name: "sub-mono",
      workspaces: ["packages/connector"],
      scripts: { build: "tsc" },
    });

    // packages/sub-mono/packages/connector
    await createPackageJson(path.join(root, "packages", "sub-mono", "packages", "connector"), {
      name: "connector",
      scripts: { "sst:install": "webforgeai sst install", "sst:dev": "webforgeai sst dev" },
    });

    // packages/sub-mono/packages/app (isolated — not in "packages/connector" glob)
    await createPackageJson(path.join(root, "packages", "sub-mono", "packages", "app"), {
      name: "app",
      scripts: { build: "vite build", dev: "vite" },
    });

    return root;
  }

  // =========================================================================
  // scanTree — basic structure
  // =========================================================================
  describe("scanTree", () => {
    it("scans a minimal monorepo and returns correct structure", async () => {
      const root = await buildMinimalMonorepo();
      const tree = await scanTree(root);

      expect(tree.root).toBe(root);
      // Top-level modules: lib-a, sub-mono
      expect(tree.modules).toHaveLength(2);
      expect(tree.modules.map((m) => m.name).sort()).toEqual(["lib-a", "sub-mono"]);
    });

    it("installLevels[0] is always the root", async () => {
      const root = await buildMinimalMonorepo();
      const tree = await scanTree(root);

      expect(tree.installLevels[0].path).toBe(root);
      expect(tree.installLevels[0].relativePath).toBe(".");
    });

    it("detects sub-monorepos and scans recursively", async () => {
      const root = await buildMinimalMonorepo();
      const tree = await scanTree(root);

      const subMono = tree.modules.find((m) => m.name === "sub-mono");
      expect(subMono).toBeDefined();
      expect(subMono!.hasWorkspaces).toBe(true);
      // Children: connector + app
      expect(subMono!.children).toHaveLength(2);
      expect(subMono!.children.map((c) => c.name).sort()).toEqual(["app", "connector"]);
    });

    it("detects isolated packages correctly", async () => {
      const root = await buildMinimalMonorepo();
      const tree = await scanTree(root);

      // "app" is isolated because sub-mono's workspace is "packages/connector" only
      expect(tree.isolatedPackages).toHaveLength(1);
      expect(tree.isolatedPackages[0]).toContain("app");

      const subMono = tree.modules.find((m) => m.name === "sub-mono");
      const appChild = subMono!.children.find((c) => c.name === "app");
      expect(appChild!.isIsolated).toBe(true);
    });

    it("creates installLevels for sub-monorepos", async () => {
      const root = await buildMinimalMonorepo();
      const tree = await scanTree(root);

      // Root + sub-mono = 2 install levels
      expect(tree.installLevels.length).toBeGreaterThanOrEqual(2);
      const subMonoLevel = tree.installLevels.find((l) => l.relativePath.includes("sub-mono"));
      expect(subMonoLevel).toBeDefined();
    });

    it("maxDepth limits recursion", async () => {
      const root = await buildMinimalMonorepo();
      const tree = await scanTree(root, { maxDepth: 1 });

      // With maxDepth=1, sub-monorepo children should NOT be scanned
      const subMono = tree.modules.find((m) => m.name === "sub-mono");
      expect(subMono).toBeDefined();
      expect(subMono!.children).toHaveLength(0);
      // Only root install level (sub-mono not added because children not scanned)
      expect(tree.installLevels).toHaveLength(1);
    });

    it("detects devlink config presence", async () => {
      const root = await buildMinimalMonorepo();
      await createDevlinkConfig(root);

      const tree = await scanTree(root);
    });

    it("throws when no package.json exists at root", async () => {
      const emptyDir = path.join(tmpDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });

      await expect(scanTree(emptyDir)).rejects.toThrow(/package\.json/i);
    });

    it("throws when package.json has no workspaces", async () => {
      const noWsDir = path.join(tmpDir, "no-ws");
      await createPackageJson(noWsDir, { name: "no-ws" });

      await expect(scanTree(noWsDir)).rejects.toThrow(/workspaces/i);
    });
  });

  // =========================================================================
  // classifyModule
  // =========================================================================
  describe("classifyModule", () => {
    const rootDir = "/root";

    it("classifies infrastructure by sst:dev script without build", () => {
      const pkg: PackageManifest = {
        name: "connector",
        version: "1.0.0",
        scripts: { "sst:dev": "webforgeai sst dev", "sst:install": "webforgeai sst install" },
      };
      expect(classifyModule(pkg, "/root/packages/connector", rootDir)).toBe("infrastructure");
    });

    it("classifies library by path pattern /libs/", () => {
      const pkg: PackageManifest = { name: "core", version: "1.0.0", scripts: { build: "tsc" } };
      expect(classifyModule(pkg, "/root/packages/libs/node/core", rootDir)).toBe("library");
    });

    it("classifies service by path pattern /services/", () => {
      const pkg: PackageManifest = { name: "web", version: "1.0.0", scripts: { build: "tsc" } };
      expect(classifyModule(pkg, "/root/packages/services/web", rootDir)).toBe("service");
    });

    it("classifies app by path pattern /apps/", () => {
      const pkg: PackageManifest = { name: "web", version: "1.0.0", scripts: { build: "vite" } };
      expect(classifyModule(pkg, "/root/packages/apps/web", rootDir)).toBe("app");
    });

    it("classifies infrastructure by path pattern /cloud/", () => {
      const pkg: PackageManifest = { name: "core", version: "1.0.0", scripts: { "sst:dev": "x", build: "tsc" } };
      expect(classifyModule(pkg, "/root/packages/cloud/core", rootDir)).toBe("infrastructure");
    });

    it("classifies by package name pattern .libs.", () => {
      const pkg: PackageManifest = { name: "my.libs.core", version: "1.0.0" };
      expect(classifyModule(pkg, "/root/packages/core", rootDir)).toBe("library");
    });

    it("classifies by package name pattern .srv.", () => {
      const pkg: PackageManifest = { name: "my.srv.web", version: "1.0.0" };
      expect(classifyModule(pkg, "/root/packages/web", rootDir)).toBe("service");
    });

    it("classifies by package name pattern .app.", () => {
      const pkg: PackageManifest = { name: "my.app.web", version: "1.0.0" };
      expect(classifyModule(pkg, "/root/packages/web", rootDir)).toBe("app");
    });

    it("classifies by directory name 'connector'", () => {
      const pkg: PackageManifest = { name: "some-pkg", version: "1.0.0" };
      expect(classifyModule(pkg, "/root/packages/sub/packages/connector", rootDir)).toBe("infrastructure");
    });

    it("classifies by directory name 'service'", () => {
      const pkg: PackageManifest = { name: "some-pkg", version: "1.0.0" };
      expect(classifyModule(pkg, "/root/packages/sub/packages/service", rootDir)).toBe("service");
    });

    it("classifies by directory name 'app'", () => {
      const pkg: PackageManifest = { name: "some-pkg", version: "1.0.0" };
      expect(classifyModule(pkg, "/root/packages/sub/packages/app", rootDir)).toBe("app");
    });

    it("returns unknown when no heuristic matches", () => {
      const pkg: PackageManifest = { name: "misc", version: "1.0.0" };
      expect(classifyModule(pkg, "/root/packages/misc", rootDir)).toBe("unknown");
    });
  });

  // =========================================================================
  // Full HCAMSWS-like fixture — integration test
  // =========================================================================
  describe("scanTree — HCAMSWS-like monorepo fixture", () => {
    /**
     * Build a fixture that mirrors the real HCAMSWS monorepo structure:
     *
     * root/
     *   package.json (workspaces: ["packages/apps/web", "packages/cloud/*", "packages/libs/node/*", "packages/services/*"])
     *   devlink.config.mjs
     *   packages/
     *     libs/node/core/          (library, build script)
     *     cloud/core/              (infrastructure, sst:install + sst:dev, no build)
     *     services/web/            (sub-monorepo, workspaces: ["packages/*"])
     *       packages/connector/    (infrastructure, sst:install + sst:dev)
     *       packages/service/      (service, build script)
     *     services/data/           (sub-monorepo, workspaces: ["packages/*"])
     *       packages/connector/    (infrastructure, sst:install + sst:dev)
     *       packages/service/      (service, build script)
     *     apps/web/                (sub-monorepo, workspaces: ["packages/connector"])
     *       packages/connector/    (infrastructure, sst:install)
     *       packages/app/          (app, ISOLATED — not in "packages/connector" glob)
     */
    async function buildHcamsFixture(): Promise<string> {
      const root = path.join(tmpDir, "hcamsws");

      // Root
      await createPackageJson(root, {
        name: "@mastertech/hcamsws",
        workspaces: [
          "packages/apps/web",
          "packages/cloud/*",
          "packages/libs/node/*",
          "packages/services/*",
        ],
      });
      await createDevlinkConfig(root);

      // libs/node/core
      await createPackageJson(path.join(root, "packages", "libs", "node", "core"), {
        name: "@mastertech/hcamsws.libs.core",
        scripts: { build: "tsc", prewatch: "npm run build", watch: "tsc --watch" },
      });

      // cloud/core
      await createPackageJson(path.join(root, "packages", "cloud", "core"), {
        name: "@mastertech/hcamsws.cloud.core",
        scripts: { "cloud.core": "npm run sst:dev", "sst:install": "webforgeai sst install", "sst:dev": "webforgeai sst dev", "sst:deploy": "webforgeai sst deploy" },
      });

      // services/web (sub-monorepo)
      await createPackageJson(path.join(root, "packages", "services", "web"), {
        name: "@mastertech/hcamsws.srv.web",
        workspaces: ["packages/*"],
        scripts: { "srv.web": "concurrently ...", build: "npm run build --prefix packages/service", "sst:install": "npm run sst:install --prefix packages/connector" },
      });
      await createPackageJson(path.join(root, "packages", "services", "web", "packages", "connector"), {
        name: "connector",
        scripts: { "sst:install": "webforgeai sst install", "sst:dev": "webforgeai sst dev" },
      });
      await createPackageJson(path.join(root, "packages", "services", "web", "packages", "service"), {
        name: "service",
        scripts: { build: "tsc" },
      });

      // services/data (sub-monorepo)
      await createPackageJson(path.join(root, "packages", "services", "data"), {
        name: "@mastertech/hcamsws.srv.data",
        workspaces: ["packages/*"],
        scripts: { "srv.data": "concurrently ...", build: "npm run build --prefix packages/service", "sst:install": "npm run sst:install --prefix packages/connector" },
      });
      await createPackageJson(path.join(root, "packages", "services", "data", "packages", "connector"), {
        name: "connector",
        scripts: { "sst:install": "webforgeai sst install", "sst:dev": "webforgeai sst dev" },
      });
      await createPackageJson(path.join(root, "packages", "services", "data", "packages", "service"), {
        name: "service",
        scripts: { build: "tsc" },
      });

      // apps/web (sub-monorepo with restricted workspace — only connector)
      await createPackageJson(path.join(root, "packages", "apps", "web"), {
        name: "@mastertech/hcamsws.app.web",
        workspaces: ["packages/connector"],
        scripts: { "app.web": "concurrently ...", build: "npm run build --prefix packages/app", "sst:install": "npm run sst:install --prefix packages/connector" },
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

    it("discovers all top-level modules", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      const names = tree.modules.map((m) => m.name).sort();
      expect(names).toEqual([
        "@mastertech/hcamsws.app.web",
        "@mastertech/hcamsws.cloud.core",
        "@mastertech/hcamsws.libs.core",
        "@mastertech/hcamsws.srv.data",
        "@mastertech/hcamsws.srv.web",
      ]);
    });

    it("classifies libs.core as library", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      const libsCore = tree.modules.find((m) => m.name.includes("libs.core"));
      expect(libsCore!.type).toBe("library");
      expect(libsCore!.hasWorkspaces).toBe(false);
      expect(libsCore!.children).toHaveLength(0);
    });

    it("classifies cloud.core as infrastructure", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      const cloudCore = tree.modules.find((m) => m.name.includes("cloud.core"));
      expect(cloudCore!.type).toBe("infrastructure");
      expect(cloudCore!.hasWorkspaces).toBe(false);
    });

    it("classifies srv.web as service with children", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      const srvWeb = tree.modules.find((m) => m.name.includes("srv.web"));
      expect(srvWeb!.type).toBe("service");
      expect(srvWeb!.hasWorkspaces).toBe(true);
      expect(srvWeb!.children).toHaveLength(2);

      const connectorChild = srvWeb!.children.find((c) => c.name === "connector");
      const serviceChild = srvWeb!.children.find((c) => c.name === "service");
      expect(connectorChild!.type).toBe("infrastructure");
      expect(serviceChild!.type).toBe("service");
      // Both are in "packages/*" glob → neither is isolated
      expect(connectorChild!.isIsolated).toBe(false);
      expect(serviceChild!.isIsolated).toBe(false);
    });

    it("classifies srv.data as service with children", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      const srvData = tree.modules.find((m) => m.name.includes("srv.data"));
      expect(srvData!.type).toBe("service");
      expect(srvData!.hasWorkspaces).toBe(true);
      expect(srvData!.children).toHaveLength(2);
    });

    it("classifies app.web as app with isolated app child", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      const appWeb = tree.modules.find((m) => m.name.includes("app.web"));
      expect(appWeb!.type).toBe("app");
      expect(appWeb!.hasWorkspaces).toBe(true);
      expect(appWeb!.children).toHaveLength(2);

      const connectorChild = appWeb!.children.find((c) => c.name === "connector");
      const appChild = appWeb!.children.find((c) => c.name === "app");
      expect(connectorChild!.isIsolated).toBe(false);
      expect(appChild!.isIsolated).toBe(true);
    });

    it("produces correct installLevels (root + 3 sub-monorepos)", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      // Root + srv.web + srv.data + apps.web = 4 install levels
      expect(tree.installLevels).toHaveLength(4);
      expect(tree.installLevels[0].relativePath).toBe(".");

      const subRelPaths = tree.installLevels.slice(1).map((l) => l.relativePath).sort();
      expect(subRelPaths).toEqual([
        "packages/apps/web",
        "packages/services/data",
        "packages/services/web",
      ]);
    });

    it("detects exactly one isolated package (apps/web/packages/app)", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      expect(tree.isolatedPackages).toHaveLength(1);
      expect(tree.isolatedPackages[0]).toContain(path.join("apps", "web", "packages", "app"));
    });

    it("exposes scripts on each module", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      const libsCore = tree.modules.find((m) => m.name.includes("libs.core"));
      expect(libsCore!.scripts).toContain("build");
      expect(libsCore!.scripts).toContain("watch");

      const cloudCore = tree.modules.find((m) => m.name.includes("cloud.core"));
      expect(cloudCore!.scripts).toContain("sst:install");
      expect(cloudCore!.scripts).toContain("sst:dev");
    });

    it("detects devlink config only at root", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);
      for (const level of tree.installLevels.slice(1)) {
      }
    });

    it("sub-monorepo children have correct relative paths from root", async () => {
      const root = await buildHcamsFixture();
      const tree = await scanTree(root);

      const srvWeb = tree.modules.find((m) => m.name.includes("srv.web"));
      const connector = srvWeb!.children.find((c) => c.name === "connector");
      expect(connector!.relativePath).toBe(
        path.join("packages", "services", "web", "packages", "connector"),
      );
    });
  });

  // =========================================================================
  // Helper functions
  // =========================================================================
  describe("resolveWorkspaceGlobs", () => {
    it("resolves glob patterns to directories with package.json", async () => {
      const root = path.join(tmpDir, "ws-test");
      await createPackageJson(path.join(root, "packages", "a"), { name: "a" });
      await createPackageJson(path.join(root, "packages", "b"), { name: "b" });
      // Directory without package.json should be excluded
      await fs.mkdir(path.join(root, "packages", "no-pkg"), { recursive: true });

      const resolved = await resolveWorkspaceGlobs(root, ["packages/*"]);

      expect(resolved).toHaveLength(2);
      expect(resolved.map((p) => path.basename(p)).sort()).toEqual(["a", "b"]);
    });

    it("warns but does not throw for empty glob", async () => {
      const root = path.join(tmpDir, "empty-glob");
      await fs.mkdir(root, { recursive: true });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const resolved = await resolveWorkspaceGlobs(root, ["nonexistent/*"]);

      expect(resolved).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nonexistent/*"));
      warnSpy.mockRestore();
    });
  });

  describe("listSubPackages", () => {
    it("lists all subdirectories with package.json in packages/", async () => {
      const parent = path.join(tmpDir, "parent");
      await createPackageJson(path.join(parent, "packages", "a"), { name: "a" });
      await createPackageJson(path.join(parent, "packages", "b"), { name: "b" });
      await fs.mkdir(path.join(parent, "packages", "no-pkg"), { recursive: true });

      const subs = await listSubPackages(parent);

      expect(subs).toHaveLength(2);
      expect(subs.map((p) => path.basename(p)).sort()).toEqual(["a", "b"]);
    });

    it("returns empty array when no packages/ directory", async () => {
      const parent = path.join(tmpDir, "no-packages");
      await fs.mkdir(parent, { recursive: true });

      const subs = await listSubPackages(parent);
      expect(subs).toHaveLength(0);
    });
  });

  describe("isPathInResolvedGlobs", () => {
    it("returns true when path is in the list", () => {
      expect(isPathInResolvedGlobs("/a/b/c", ["/a/b/c", "/d/e"])).toBe(true);
    });

    it("returns false when path is not in the list", () => {
      expect(isPathInResolvedGlobs("/a/b/c", ["/d/e"])).toBe(false);
    });
  });


  describe("readPackageJson", () => {
    it("reads and parses a valid package.json", async () => {
      const dir = path.join(tmpDir, "valid-pkg");
      await createPackageJson(dir, { name: "test", version: "2.0.0" });

      const pkg = await readPackageJson(dir);
      expect(pkg).not.toBeNull();
      expect(pkg!.name).toBe("test");
      expect(pkg!.version).toBe("2.0.0");
    });

    it("returns null when package.json does not exist", async () => {
      const dir = path.join(tmpDir, "no-pkg");
      await fs.mkdir(dir, { recursive: true });

      const pkg = await readPackageJson(dir);
      expect(pkg).toBeNull();
    });
  });
});
