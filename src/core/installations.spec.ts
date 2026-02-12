/**
 * Installations - Unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  createEmptyInstallations,
  readInstallations,
  writeInstallations,
  normalizeProjectPath,
  registerProject,
  updateProjectPackage,
  unregisterProject,
  removePackageFromProject,
  getConsumers,
  getConsumersByNamespace,
  pruneDeadProjects,
  getAllProjects,
  getProject,
  getTotalProjectCount,
  getAllInstalledPackages,
} from "./installations.js";
import type { InstalledPackage } from "../types.js";

const TEST_STORE_PATH = path.join(os.tmpdir(), "devlink-installations-test-" + Date.now());
const TEST_PROJECT_PATH = path.join(os.tmpdir(), "devlink-test-project-" + Date.now());

vi.mock("../constants.js", () => ({
  getStorePath: () => TEST_STORE_PATH,
  getInstallationsPath: () => path.join(TEST_STORE_PATH, "installations.json"),
  INSTALLATIONS_VERSION: "1.0.0",
}));

describe("Installations", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORE_PATH, { recursive: true });
    await fs.mkdir(TEST_PROJECT_PATH, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_STORE_PATH, { recursive: true, force: true });
    await fs.rm(TEST_PROJECT_PATH, { recursive: true, force: true });
  });

  describe("createEmptyInstallations", () => {
    it("should create empty installations", () => {
      const installations = createEmptyInstallations();
      
      expect(installations.version).toBe("1.0.0");
      expect(installations.projects).toEqual({});
    });
  });

  describe("readInstallations / writeInstallations", () => {
    it("should return empty installations when file doesn't exist", async () => {
      const installations = await readInstallations();
      
      expect(installations.version).toBe("1.0.0");
      expect(installations.projects).toEqual({});
    });

    it("should write and read installations", async () => {
      const installations = createEmptyInstallations();
      installations.projects["/test/project"] = {
        registered: "2026-02-12T10:00:00Z",
        packages: {},
      };

      await writeInstallations(installations);
      const read = await readInstallations();

      expect(read.projects["/test/project"]).toBeDefined();
    });
  });

  describe("normalizeProjectPath", () => {
    it("should resolve relative paths", () => {
      const normalized = normalizeProjectPath("./project");
      expect(path.isAbsolute(normalized)).toBe(true);
    });

    it("should keep absolute paths", () => {
      const normalized = normalizeProjectPath("/absolute/path");
      expect(normalized).toBe("/absolute/path");
    });
  });

  describe("registerProject", () => {
    it("should register new project", () => {
      const installations = createEmptyInstallations();
      const packages: Record<string, InstalledPackage> = {
        "pkg": {
          version: "1.0.0",
          namespace: "global",
          signature: "abc123",
          installedAt: "2026-02-12T10:00:00Z",
        },
      };

      registerProject(installations, "/test/project", packages);

      const normalized = normalizeProjectPath("/test/project");
      expect(installations.projects[normalized]).toBeDefined();
      expect(installations.projects[normalized].packages.pkg).toBeDefined();
    });

    it("should merge packages for existing project", () => {
      const installations = createEmptyInstallations();
      
      registerProject(installations, "/test/project", {
        "pkg1": {
          version: "1.0.0",
          namespace: "global",
          signature: "abc123",
          installedAt: "2026-02-12T10:00:00Z",
        },
      });
      
      registerProject(installations, "/test/project", {
        "pkg2": {
          version: "2.0.0",
          namespace: "global",
          signature: "def456",
          installedAt: "2026-02-12T11:00:00Z",
        },
      });

      const normalized = normalizeProjectPath("/test/project");
      expect(installations.projects[normalized].packages.pkg1).toBeDefined();
      expect(installations.projects[normalized].packages.pkg2).toBeDefined();
    });
  });

  describe("updateProjectPackage", () => {
    it("should update single package", () => {
      const installations = createEmptyInstallations();
      
      updateProjectPackage(installations, "/test/project", "pkg", {
        version: "1.0.0",
        namespace: "global",
        signature: "abc123",
        installedAt: "2026-02-12T10:00:00Z",
      });

      const normalized = normalizeProjectPath("/test/project");
      expect(installations.projects[normalized].packages.pkg.version).toBe("1.0.0");
    });

    it("should create project if not exists", () => {
      const installations = createEmptyInstallations();
      
      updateProjectPackage(installations, "/new/project", "pkg", {
        version: "1.0.0",
        namespace: "global",
        signature: "abc123",
        installedAt: "2026-02-12T10:00:00Z",
      });

      const normalized = normalizeProjectPath("/new/project");
      expect(installations.projects[normalized]).toBeDefined();
    });
  });

  describe("unregisterProject", () => {
    it("should remove project", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/test/project", {});

      const removed = unregisterProject(installations, "/test/project");

      expect(removed).toBe(true);
      const normalized = normalizeProjectPath("/test/project");
      expect(installations.projects[normalized]).toBeUndefined();
    });

    it("should return false for non-existent project", () => {
      const installations = createEmptyInstallations();
      const removed = unregisterProject(installations, "/nonexistent");
      expect(removed).toBe(false);
    });
  });

  describe("removePackageFromProject", () => {
    it("should remove package from project", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/test/project", {
        "pkg1": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T10:00:00Z" },
        "pkg2": { version: "2.0.0", namespace: "global", signature: "def", installedAt: "2026-02-12T11:00:00Z" },
      });

      const removed = removePackageFromProject(installations, "/test/project", "pkg1");

      expect(removed).toBe(true);
      const normalized = normalizeProjectPath("/test/project");
      expect(installations.projects[normalized].packages.pkg1).toBeUndefined();
      expect(installations.projects[normalized].packages.pkg2).toBeDefined();
    });

    it("should clean up empty project", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/test/project", {
        "pkg": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T10:00:00Z" },
      });

      removePackageFromProject(installations, "/test/project", "pkg");

      const normalized = normalizeProjectPath("/test/project");
      expect(installations.projects[normalized]).toBeUndefined();
    });
  });

  describe("getConsumers", () => {
    it("should find consumers of a package", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/project1", {
        "pkg": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T10:00:00Z" },
      });
      registerProject(installations, "/project2", {
        "pkg": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T11:00:00Z" },
      });
      registerProject(installations, "/project3", {
        "other": { version: "1.0.0", namespace: "global", signature: "def", installedAt: "2026-02-12T12:00:00Z" },
      });

      const consumers = getConsumers(installations, "pkg");

      expect(consumers).toHaveLength(2);
    });

    it("should filter by namespace", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/project1", {
        "pkg": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T10:00:00Z" },
      });
      registerProject(installations, "/project2", {
        "pkg": { version: "1.0.0", namespace: "feature", signature: "def", installedAt: "2026-02-12T11:00:00Z" },
      });

      const consumers = getConsumers(installations, "pkg", { namespace: "global" });

      expect(consumers).toHaveLength(1);
    });

    it("should filter by version", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/project1", {
        "pkg": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T10:00:00Z" },
      });
      registerProject(installations, "/project2", {
        "pkg": { version: "2.0.0", namespace: "global", signature: "def", installedAt: "2026-02-12T11:00:00Z" },
      });

      const consumers = getConsumers(installations, "pkg", { version: "1.0.0" });

      expect(consumers).toHaveLength(1);
    });
  });

  describe("getConsumersByNamespace", () => {
    it("should find consumers by namespace", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/project1", {
        "pkg1": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T10:00:00Z" },
        "pkg2": { version: "1.0.0", namespace: "feature", signature: "def", installedAt: "2026-02-12T11:00:00Z" },
      });

      const consumers = getConsumersByNamespace(installations, "global");

      expect(consumers).toHaveLength(1);
      expect(Object.keys(consumers[0].packages)).toContain("pkg1");
      expect(Object.keys(consumers[0].packages)).not.toContain("pkg2");
    });
  });

  describe("pruneDeadProjects", () => {
    it("should remove non-existent projects", async () => {
      const installations = createEmptyInstallations();
      registerProject(installations, TEST_PROJECT_PATH, {
        "pkg": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T10:00:00Z" },
      });
      registerProject(installations, "/nonexistent/project", {
        "pkg": { version: "1.0.0", namespace: "global", signature: "def", installedAt: "2026-02-12T11:00:00Z" },
      });

      const removed = await pruneDeadProjects(installations);

      expect(removed).toContain(normalizeProjectPath("/nonexistent/project"));
      expect(installations.projects[normalizeProjectPath(TEST_PROJECT_PATH)]).toBeDefined();
    });
  });

  describe("getAllProjects", () => {
    it("should return all project paths sorted", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/z/project", {});
      registerProject(installations, "/a/project", {});

      const projects = getAllProjects(installations);

      expect(projects[0]).toBe(normalizeProjectPath("/a/project"));
      expect(projects[1]).toBe(normalizeProjectPath("/z/project"));
    });
  });

  describe("getTotalProjectCount", () => {
    it("should count projects", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/project1", {});
      registerProject(installations, "/project2", {});

      const count = getTotalProjectCount(installations);
      expect(count).toBe(2);
    });
  });

  describe("getAllInstalledPackages", () => {
    it("should aggregate packages across projects", () => {
      const installations = createEmptyInstallations();
      registerProject(installations, "/project1", {
        "pkg1": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T10:00:00Z" },
        "pkg2": { version: "1.0.0", namespace: "global", signature: "def", installedAt: "2026-02-12T11:00:00Z" },
      });
      registerProject(installations, "/project2", {
        "pkg1": { version: "1.0.0", namespace: "global", signature: "abc", installedAt: "2026-02-12T12:00:00Z" },
      });

      const packages = getAllInstalledPackages(installations);

      expect(packages).toHaveLength(2);
      const pkg1 = packages.find(p => p.packageName === "pkg1");
      expect(pkg1?.consumers).toBe(2);
    });
  });
});
