/**
 * Unit Tests - Config Normalizer
 *
 * Tests for isNewFormat, normalizeConfig, resolveVersion, resolveMode,
 * hasModesObject, and validateModesObject.
 * Supported formats:
 *   - { version: { mode: "ver" }, synthetic?: boolean }  (per-mode)
 *   - { version: "ver", synthetic?: boolean }             (universal)
 *   - V2 modes object: { modes: { default: "dev", dev: () => ... }, packages: {...} }
 */

import { describe, it, expect } from "vitest";
import { isNewFormat, normalizeConfig, resolveVersion, resolveMode, hasModesObject, validateModesObject } from "./config.js";
import type { DevLinkConfig, DevLinkConfigV2 } from "./types.js";

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

    it("returns true when version is a string (universal)", () => {
      expect(isNewFormat({ version: "1.0.0" })).toBe(true);
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

    it("normalizes string version (universal) to wildcard key", () => {
      const devFactory = () => ({ manager: "store" as const });
      const config: DevLinkConfig = {
        packages: {
          "@test/core": { version: "2.0.0" },
          "@test/sst": { version: "2.0.0", synthetic: true },
        },
        dev: devFactory,
      };

      const normalized = normalizeConfig(config);

      expect(normalized.packages["@test/core"].versions).toEqual({ "*": "2.0.0" });
      expect(normalized.packages["@test/core"].synthetic).toBe(false);
      expect(normalized.packages["@test/sst"].versions).toEqual({ "*": "2.0.0" });
      expect(normalized.packages["@test/sst"].synthetic).toBe(true);
    });
  });

  // =========================================================================
  // resolveVersion
  // =========================================================================
  describe("resolveVersion", () => {
    it("returns version for matching mode (per-mode format)", () => {
      expect(resolveVersion({ version: { dev: "1.0.0", remote: "2.0.0" } }, "dev")).toBe("1.0.0");
      expect(resolveVersion({ version: { dev: "1.0.0", remote: "2.0.0" } }, "remote")).toBe("2.0.0");
    });

    it("returns undefined for missing mode (per-mode format)", () => {
      expect(resolveVersion({ version: { dev: "1.0.0" } }, "remote")).toBeUndefined();
    });

    it("returns the string for any mode (universal format)", () => {
      expect(resolveVersion({ version: "3.0.0" }, "dev")).toBe("3.0.0");
      expect(resolveVersion({ version: "3.0.0" }, "remote")).toBe("3.0.0");
      expect(resolveVersion({ version: "3.0.0" }, "anything")).toBe("3.0.0");
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

  // =========================================================================
  // hasModesObject
  // =========================================================================
  describe("hasModesObject", () => {
    it("returns true for config with modes object", () => {
      const config: DevLinkConfigV2 = {
        modes: {
          default: "dev",
          dev: () => ({ manager: "store" }),
        },
        packages: { "@test/core": { version: "1.0.0" } },
      };
      expect(hasModesObject(config)).toBe(true);
    });

    it("returns false for legacy config without modes", () => {
      const config: DevLinkConfig = {
        packages: { "@test/core": { version: "1.0.0" } },
        dev: () => ({ manager: "store" }),
      };
      expect(hasModesObject(config)).toBe(false);
    });

    it("returns false when modes is null", () => {
      const config = {
        packages: { "@test/core": { version: "1.0.0" } },
        modes: null,
      } as unknown as DevLinkConfig;
      expect(hasModesObject(config)).toBe(false);
    });

    it("returns false when modes is an array", () => {
      const config = {
        packages: { "@test/core": { version: "1.0.0" } },
        modes: ["dev"],
      } as unknown as DevLinkConfig;
      expect(hasModesObject(config)).toBe(false);
    });
  });

  // =========================================================================
  // validateModesObject
  // =========================================================================
  describe("validateModesObject", () => {
    it("passes for valid modes object", () => {
      const config: DevLinkConfigV2 = {
        modes: {
          default: "dev",
          dev: () => ({ manager: "store" }),
          remote: () => ({ manager: "npm" }),
        },
        packages: { "@test/core": { version: "1.0.0" } },
      };
      expect(() => validateModesObject(config)).not.toThrow();
    });

    it("throws when modes.default is not a string", () => {
      const config = {
        modes: {
          default: 123,
          dev: () => ({ manager: "store" }),
        },
        packages: { "@test/core": { version: "1.0.0" } },
      } as unknown as DevLinkConfigV2;
      expect(() => validateModesObject(config)).toThrow('"modes.default" must be a non-empty string');
    });

    it("throws when modes.default is an empty string", () => {
      const config = {
        modes: {
          default: "  ",
          dev: () => ({ manager: "store" }),
        },
        packages: { "@test/core": { version: "1.0.0" } },
      } as unknown as DevLinkConfigV2;
      expect(() => validateModesObject(config)).toThrow('"modes.default" must be a non-empty string');
    });

    it("throws when modes.default references non-existent mode", () => {
      const config: DevLinkConfigV2 = {
        modes: {
          default: "prod",
          dev: () => ({ manager: "store" }),
        },
        packages: { "@test/core": { version: "1.0.0" } },
      };
      expect(() => validateModesObject(config)).toThrow(
        '"modes.default" references "prod" which does not exist'
      );
    });

    it("throws when a non-default entry is not a function", () => {
      const config = {
        modes: {
          default: "dev",
          dev: () => ({ manager: "store" }),
          broken: "not-a-function",
        },
        packages: { "@test/core": { version: "1.0.0" } },
      } as unknown as DevLinkConfigV2;
      expect(() => validateModesObject(config)).toThrow(
        'Mode "broken" must be a function (ModeFactory), got string'
      );
    });

    it("includes available modes in error message", () => {
      const config: DevLinkConfigV2 = {
        modes: {
          default: "staging",
          dev: () => ({ manager: "store" }),
          remote: () => ({ manager: "npm" }),
        },
        packages: { "@test/core": { version: "1.0.0" } },
      };
      expect(() => validateModesObject(config)).toThrow("dev, remote");
    });
  });

  // =========================================================================
  // resolveMode — V2 format (modes object)
  // =========================================================================
  describe("resolveMode — V2 format", () => {
    const v2Config: DevLinkConfigV2 = {
      modes: {
        default: "dev",
        dev: () => ({ manager: "store" }),
        remote: () => ({ manager: "npm" }),
      },
      packages: { "@test/core": { version: "1.0.0" } },
    };

    it("returns modes.default when no explicit mode provided", () => {
      expect(resolveMode(v2Config)).toBe("dev");
    });

    it("returns explicit mode when provided", () => {
      expect(resolveMode(v2Config, "remote")).toBe("remote");
    });

    it("returns explicit mode even when it differs from default", () => {
      expect(resolveMode(v2Config, "remote")).toBe("remote");
      expect(resolveMode(v2Config, "dev")).toBe("dev");
    });

    it("throws when explicit mode does not exist in modes", () => {
      expect(() => resolveMode(v2Config, "staging")).toThrow(
        'Mode "staging" is not defined in modes'
      );
    });

    it("throws when modes.default references invalid mode", () => {
      const badConfig: DevLinkConfigV2 = {
        modes: {
          default: "nonexistent",
          dev: () => ({ manager: "store" }),
        },
        packages: { "@test/core": { version: "1.0.0" } },
      };
      expect(() => resolveMode(badConfig)).toThrow(
        '"modes.default" references "nonexistent"'
      );
    });

    it("lists available modes in error message for invalid explicit mode", () => {
      expect(() => resolveMode(v2Config, "prod")).toThrow("dev, remote");
    });
  });

  // =========================================================================
  // resolveMode — Legacy format (top-level factories)
  // =========================================================================
  describe("resolveMode — Legacy format", () => {
    const legacyConfig: DevLinkConfig = {
      packages: { "@test/core": { version: "1.0.0" } },
      dev: () => ({ manager: "store" }),
      remote: () => ({ manager: "npm" }),
    };

    it("returns explicit mode when provided", () => {
      expect(resolveMode(legacyConfig, "dev")).toBe("dev");
      expect(resolveMode(legacyConfig, "remote")).toBe("remote");
    });

    it("throws when no explicit mode and no modes.default", () => {
      expect(() => resolveMode(legacyConfig)).toThrow(
        'No --mode flag provided and no "modes.default" configured'
      );
    });

    it("throws when explicit mode does not exist as top-level function", () => {
      expect(() => resolveMode(legacyConfig, "staging")).toThrow(
        'Mode "staging" is not defined in configuration'
      );
    });

    it("lists available modes in error for invalid explicit mode", () => {
      expect(() => resolveMode(legacyConfig, "prod")).toThrow("dev, remote");
    });
  });

  // =========================================================================
  // normalizeConfig — V2 format (modes object)
  // =========================================================================
  describe("normalizeConfig — V2 format", () => {
    it("extracts mode factories from modes object", () => {
      const devFactory = () => ({ manager: "store" as const });
      const remoteFactory = () => ({ manager: "npm" as const });
      const config: DevLinkConfigV2 = {
        modes: {
          default: "dev",
          dev: devFactory,
          remote: remoteFactory,
        },
        packages: { "@test/core": { version: "1.0.0" } },
      };

      const normalized = normalizeConfig(config);

      expect(normalized.modes.dev).toBe(devFactory);
      expect(normalized.modes.remote).toBe(remoteFactory);
      expect(Object.keys(normalized.modes)).toEqual(["dev", "remote"]);
    });

    it("does not include default key in normalized modes", () => {
      const config: DevLinkConfigV2 = {
        modes: {
          default: "dev",
          dev: () => ({ manager: "store" }),
        },
        packages: { "@test/core": { version: "1.0.0" } },
      };

      const normalized = normalizeConfig(config);

      expect("default" in normalized.modes).toBe(false);
    });

    it("normalizes packages correctly in V2 format", () => {
      const config: DevLinkConfigV2 = {
        modes: {
          default: "dev",
          dev: () => ({ manager: "store" }),
        },
        packages: {
          "@test/core": { version: "2.0.0" },
          "@test/sst": { version: { dev: "1.0.0" }, synthetic: true },
        },
      };

      const normalized = normalizeConfig(config);

      expect(normalized.packages["@test/core"].versions).toEqual({ "*": "2.0.0" });
      expect(normalized.packages["@test/sst"].versions).toEqual({ dev: "1.0.0" });
      expect(normalized.packages["@test/sst"].synthetic).toBe(true);
    });
  });
});