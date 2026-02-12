/**
 * Docs Command - Unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  DocEntry,
  normalizePath,
  buildDocTree,
  findDocument,
  formatTree,
  formatDirectoryListing,
  readDocument,
  readAgents,
} from "./docs.js";

const TEST_DOCS_PATH = path.join(os.tmpdir(), "devlink-docs-test-" + Date.now());

describe("Docs Command", () => {
  beforeEach(async () => {
    // Create test documentation structure
    await fs.mkdir(TEST_DOCS_PATH, { recursive: true });
    
    // Create directories
    await fs.mkdir(path.join(TEST_DOCS_PATH, "store"), { recursive: true });
    await fs.mkdir(path.join(TEST_DOCS_PATH, "publishing"), { recursive: true });
    await fs.mkdir(path.join(TEST_DOCS_PATH, "empty-dir"), { recursive: true });
    
    // Create files
    await fs.writeFile(
      path.join(TEST_DOCS_PATH, "README.md"),
      "# Documentation Index\n\nWelcome to docs."
    );
    await fs.writeFile(
      path.join(TEST_DOCS_PATH, "store", "structure.md"),
      "# Store Structure\n\nThe store is located at ~/.devlink"
    );
    await fs.writeFile(
      path.join(TEST_DOCS_PATH, "store", "namespaces.md"),
      "# Namespaces\n\nNamespaces provide isolation."
    );
    await fs.writeFile(
      path.join(TEST_DOCS_PATH, "publishing", "publish.md"),
      "# Publish Command\n\nPublish packages to the store."
    );
    
    // Create AGENTS.md
    await fs.writeFile(
      path.join(TEST_DOCS_PATH, "AGENTS.md"),
      "# Agent Guide\n\nComplete guide for AI agents."
    );
  });

  afterEach(async () => {
    await fs.rm(TEST_DOCS_PATH, { recursive: true, force: true });
  });

  describe("normalizePath", () => {
    it("should convert to lowercase", () => {
      expect(normalizePath("STORE/NAMESPACES")).toBe("store/namespaces");
    });

    it("should remove .md extension", () => {
      expect(normalizePath("store/namespaces.md")).toBe("store/namespaces");
    });

    it("should normalize backslashes", () => {
      expect(normalizePath("store\\namespaces")).toBe("store/namespaces");
    });

    it("should handle combined cases", () => {
      expect(normalizePath("STORE\\NAMESPACES.MD")).toBe("store/namespaces");
    });
  });

  describe("buildDocTree", () => {
    it("should build tree from directory", () => {
      const tree = buildDocTree(TEST_DOCS_PATH);
      
      // Should have directories first, then files
      expect(tree.length).toBeGreaterThan(0);
      
      // Find store directory
      const storeDir = tree.find(e => e.name === "store");
      expect(storeDir).toBeDefined();
      expect(storeDir?.type).toBe("directory");
      expect(storeDir?.children?.length).toBe(2);
    });

    it("should sort directories before files", () => {
      const tree = buildDocTree(TEST_DOCS_PATH);
      
      // First entries should be directories
      const firstDir = tree.findIndex(e => e.type === "directory");
      const firstFile = tree.findIndex(e => e.type === "file");
      
      if (firstDir !== -1 && firstFile !== -1) {
        expect(firstDir).toBeLessThan(firstFile);
      }
    });

    it("should exclude hidden files", async () => {
      await fs.writeFile(path.join(TEST_DOCS_PATH, ".hidden.md"), "hidden");
      
      const tree = buildDocTree(TEST_DOCS_PATH);
      const hidden = tree.find(e => e.name === ".hidden");
      
      expect(hidden).toBeUndefined();
    });

    it("should only include .md files", async () => {
      await fs.writeFile(path.join(TEST_DOCS_PATH, "test.txt"), "text file");
      
      const tree = buildDocTree(TEST_DOCS_PATH);
      const txtFile = tree.find(e => e.name === "test");
      
      expect(txtFile).toBeUndefined();
    });

    it("should handle empty directories", () => {
      const tree = buildDocTree(TEST_DOCS_PATH);
      const emptyDir = tree.find(e => e.name === "empty-dir");
      
      expect(emptyDir).toBeDefined();
      expect(emptyDir?.children).toEqual([]);
    });

    it("should return empty array for non-existent directory", () => {
      const tree = buildDocTree("/non/existent/path");
      expect(tree).toEqual([]);
    });
  });

  describe("findDocument", () => {
    it("should find file by exact path", () => {
      const tree = buildDocTree(TEST_DOCS_PATH);
      const result = findDocument(tree, "store/structure");
      
      expect(result).not.toBeNull();
      expect(result?.entry.name).toBe("structure");
      expect(result?.entry.type).toBe("file");
    });

    it("should find file case insensitively", () => {
      const tree = buildDocTree(TEST_DOCS_PATH);
      const result = findDocument(tree, "STORE/STRUCTURE");
      
      expect(result).not.toBeNull();
      expect(result?.entry.name).toBe("structure");
    });

    it("should find directory", () => {
      const tree = buildDocTree(TEST_DOCS_PATH);
      const result = findDocument(tree, "store");
      
      expect(result).not.toBeNull();
      expect(result?.entry.type).toBe("directory");
    });

    it("should return null for non-existent path", () => {
      const tree = buildDocTree(TEST_DOCS_PATH);
      const result = findDocument(tree, "nonexistent/path");
      
      expect(result).toBeNull();
    });

    it("should handle path with .md extension", () => {
      const tree = buildDocTree(TEST_DOCS_PATH);
      const result = findDocument(tree, "store/structure.md");
      
      expect(result).not.toBeNull();
      expect(result?.entry.name).toBe("structure");
    });
  });

  describe("formatTree", () => {
    it("should format tree with connectors", () => {
      const entries: DocEntry[] = [
        { name: "dir", path: "dir", type: "directory", children: [] },
        { name: "file", path: "file", type: "file" },
      ];
      
      const output = formatTree(entries);
      
      expect(output).toContain("├── dir/");
      expect(output).toContain("└── file");
    });

    it("should format nested directories", () => {
      const entries: DocEntry[] = [
        {
          name: "parent",
          path: "parent",
          type: "directory",
          children: [
            { name: "child", path: "parent/child", type: "file" },
          ],
        },
      ];
      
      const output = formatTree(entries);
      
      expect(output).toContain("└── parent/");
      expect(output).toContain("└── child");
    });

    it("should handle empty array", () => {
      const output = formatTree([]);
      expect(output).toBe("");
    });
  });

  describe("formatDirectoryListing", () => {
    it("should format directory with children", () => {
      const entry: DocEntry = {
        name: "store",
        path: "store",
        type: "directory",
        children: [
          { name: "structure", path: "store/structure", type: "file" },
          { name: "namespaces", path: "store/namespaces", type: "file" },
        ],
      };
      
      const output = formatDirectoryListing(entry);
      
      expect(output).toContain("📁 store/");
      expect(output).toContain("Documents:");
      expect(output).toContain("structure");
      expect(output).toContain("namespaces");
      expect(output).toContain("Usage: devlink docs store/<document>");
    });

    it("should handle empty directory", () => {
      const entry: DocEntry = {
        name: "empty",
        path: "empty",
        type: "directory",
        children: [],
      };
      
      const output = formatDirectoryListing(entry);
      
      expect(output).toContain("(empty directory)");
    });

    it("should show subdirectories with trailing slash", () => {
      const entry: DocEntry = {
        name: "parent",
        path: "parent",
        type: "directory",
        children: [
          { name: "subdir", path: "parent/subdir", type: "directory", children: [] },
        ],
      };
      
      const output = formatDirectoryListing(entry);
      
      expect(output).toContain("subdir/");
    });
  });

  describe("readDocument", () => {
    it("should read document content", () => {
      const content = readDocument("store/structure", TEST_DOCS_PATH);
      
      expect(content).not.toBeNull();
      expect(content).toContain("# Store Structure");
    });

    it("should return null for non-existent document", () => {
      const content = readDocument("nonexistent", TEST_DOCS_PATH);
      
      expect(content).toBeNull();
    });
  });

  describe("readAgents", () => {
    it("should read AGENTS.md content", () => {
      const agentsPath = path.join(TEST_DOCS_PATH, "AGENTS.md");
      const content = readAgents(agentsPath);
      
      expect(content).not.toBeNull();
      expect(content).toContain("# Agent Guide");
    });

    it("should return null for non-existent file", () => {
      const content = readAgents("/nonexistent/AGENTS.md");
      
      expect(content).toBeNull();
    });
  });
});
