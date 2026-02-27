/**
 * Unit Tests - Config Normalizer
 *
 * Tests for isNewFormat and normalizeConfig.
 * Only new format supported: { version: { mode: "ver" }, synthetic?: boolean }
 */

import { describe, it, expect } from "vitest";
import { isNewFormat, normalizeConfig } from "./config.js";
import type { DevLinkConfig } from "./types.js";

describe("Config Normalizer", () => {
  // =========================================================================
  // isNewFormat
  // =========================================================================
  describe("isNewFormat", () => {
    it("returns true for format with version object", () => {
      expect(isNewFormat({ version: { dev: "1.0.0" } })).toBe(true);
    });

    it("returns true for format with synthetic flag", () => {
      expect(isNewFormat({ version: { dev: "1.0.0" }, synthetic: true })).toBe(true);
    });

    it("returns false for null", () => {
      expect(isNewFormat(null)).toBe(false);
    });

    it("returns false for array", () => {
      expect(isNewFormat(["1.0.0"])).toBe(false);
    });

    it("returns false for string", () => {
      expect(isNewFormat("1.0.0")).toBe(false);
    });

    it("returns false when version is a string (not object)", () => {
      expect(isNewFormat({ version: "1.0.0" })).toBe(false);
    });

    it("returns false when version is an array", () => {
      expect(isNewFormat({ version: ["1.0.0"] })).toBe(false);
    });

    it("returns false when version is null", () => {
      expect(isNewFormat({ version: null })).toBe(false);
    });
  });

  // =========================================================================
  // normalizeConfig
  // =========================================================================
  describe("normalizeConfig", () => {
    it("produces NormalizedConfig with correct versions and synthetic", () => {
      const devFactory = () => ({ manager: "store" as const });
      const config: DevLinkConfig = {
        packages: {
          "@test/core": { version: { dev: "1.0.0", remote: "1.0.0" } },
          "@test/sst": { version: { dev: "0.3.0" }, synthetic: true },
        },
        dev: devFactory,
        remote: devFactory,
      };

      const normalized = normalizeConfig(config);

      expect(normalized.packages["@test/core"].versions).toEqual({ dev: "1.0.0", remote: "1.0.0" });
      expect(normalized.packages["@test/core"].synthetic).toBe(false);
      expect(normalized.packages["@test/sst"].versions).toEqual({ dev: "0.3.0" });
      expect(normalized.packages["@test/sst"].synthetic).toBe(true);
    });

    it("extracts mode factories from top-level functions", () => {
      const devFactory = () => ({ manager: "store" as const });
      const remoteFactory = () => ({ manager: "npm" as const });
      const config: DevLinkConfig = {
        packages: {
          "@test/core": { version: { dev: "1.0.0" } },
        },
        dev: devFactory,
        remote: remoteFactory,
      };

      const normalized = normalizeConfig(config);

      expect(normalized.modes.dev).toBe(devFactory);
      expect(normalized.modes.remote).toBe(remoteFactory);
    });
  });

  // =========================================================================
  // normalizeConfig — error cases
  // =========================================================================
  describe("normalizeConfig — errors", () => {
    it("throws for unrecognized format with package name in message", () => {
      const config: DevLinkConfig = {
        packages: {
          "@test/broken": { version: 123 } as any,
        },
        dev: () => ({ manager: "store" as const }),
      };

      expect(() => normalizeConfig(config)).toThrow("@test/broken");
    });

    it("throws for flat string values (legacy format not supported)", () => {
      const config = {
        packages: {
          "@test/core": { dev: "1.0.0" },
        },
        dev: () => ({ manager: "store" as const }),
      } as unknown as DevLinkConfig;

      expect(() => normalizeConfig(config)).toThrow("@test/core");
    });
  });
});
