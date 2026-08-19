/**
 * Tests for {@link NpmSafeEngine.ciScan} and the pure helpers in
 * `scanner/ci-scan.ts`.
 *
 * These tests are network-free: `checkPackage` is stubbed via
 * `vi.spyOn(NpmSafeEngine.prototype, ...)` so no registry calls are made. The
 * lockfile/manifest readers are exercised against real fixture files written
 * to a temp directory. The fail-gate formula, summary aggregation, prod
 * filtering, lockfile v2/v3 + v1 parsing, and `recordCheckHistory` integration
 * are all asserted for real.
 */

import { describe, it, afterEach, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NpmSafeEngine } from "../src/index.js";
import type { CheckResult } from "../src/index.js";
import { SecurityLevel } from "../src/scanner/types.js";
import {
  readDependencies,
  readLockfileDependencies,
} from "../src/scanner/ci-scan.js";

/**
 * Build a canned {@link CheckResult} for a package at a given level/score.
 * The static scan report is populated so `findingCount` is derivable.
 */
function makeResult(
  name: string,
  level: SecurityLevel,
  score: number,
): CheckResult {
  return {
    packageName: name,
    exists: true,
    latestVersion: "1.0.0",
    security: {
      overallLevel: level,
      overallScore: score,
      staticScan: {
        packageName: name,
        version: "1.0.0",
        overallLevel: level,
        score,
        findings: [],
        scannedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    registryInfo: { description: "", homepage: "", repository: "" },
    cachedAt: null,
  };
}

describe("NpmSafeEngine.ciScan", () => {
  let tmpDir: string;
  let engine: NpmSafeEngine;

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      engine?.close();
    } catch {
      // ignore
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // --------------------------------------------------------------------------
  // (1) No package.json → rejects
  // --------------------------------------------------------------------------
  it("rejects when package.json is missing", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-ci-"));
    engine = new NpmSafeEngine({ dbPath: path.join(tmpDir, "test.db") });

    await expect(engine.ciScan({ dir: tmpDir })).rejects.toThrow(
      /No package\.json found/,
    );
  });

  // --------------------------------------------------------------------------
  // (2) Empty deps → dependencyCount 0, failed false
  // --------------------------------------------------------------------------
  it("returns dependencyCount 0 and failed false for empty deps", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-ci-"));
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "empty", version: "0.0.0" }),
    );
    engine = new NpmSafeEngine({ dbPath: path.join(tmpDir, "test.db") });

    const report = await engine.ciScan({ dir: tmpDir });

    expect(report.dependencyCount).toBe(0);
    expect(report.failed).toBe(false);
    expect(report.packages).toEqual([]);
    expect(report.summary.errors).toBe(0);
  });

  // --------------------------------------------------------------------------
  // (3) Fail gate: dep at failLevel → failed true, below → false
  // --------------------------------------------------------------------------
  it("fail gate: dep at failLevel → failed true, below → false", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-ci-"));
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test",
        version: "0.0.0",
        dependencies: { "danger-pkg": "^1.0.0" },
      }),
    );
    engine = new NpmSafeEngine({ dbPath: path.join(tmpDir, "test.db") });

    const checkSpy = vi.spyOn(NpmSafeEngine.prototype, "checkPackage");

    // Dep AT failLevel (Dangerous == Dangerous) → failed: true
    checkSpy.mockResolvedValue(
      makeResult("danger-pkg", SecurityLevel.Dangerous, 15),
    );
    const failReport = await engine.ciScan({
      dir: tmpDir,
      failLevel: SecurityLevel.Dangerous,
    });
    expect(failReport.failed).toBe(true);
    expect(failReport.summary.dangerous).toBe(1);
    expect(failReport.packages[0].level).toBe(SecurityLevel.Dangerous);

    // Dep BELOW failLevel (Safe is less severe than Dangerous) → failed: false
    checkSpy.mockResolvedValue(
      makeResult("danger-pkg", SecurityLevel.Safe, 95),
    );
    const passReport = await engine.ciScan({
      dir: tmpDir,
      failLevel: SecurityLevel.Dangerous,
    });
    expect(passReport.failed).toBe(false);
    expect(passReport.summary.safe).toBe(1);
    expect(passReport.packages[0].level).toBe(SecurityLevel.Safe);
  });

  // --------------------------------------------------------------------------
  // (4) Lockfile v2/v3 parsing incl. nested node_modules/a/node_modules/d
  //     + v1 dependencies-tree fallback
  // --------------------------------------------------------------------------
  it("parses lockfile v2/v3 packages map including nested node_modules and v1 fallback", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-ci-"));
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test",
        version: "0.0.0",
        dependencies: { a: "^1.0.0" },
      }),
    );

    // v2/v3 lockfile with `packages` map, including a nested
    // node_modules/a/node_modules/d entry (the innermost package name "d"
    // must be extracted, not "a").
    writeFileSync(
      path.join(tmpDir, "package-lock.json"),
      JSON.stringify({
        name: "test",
        version: "0.0.0",
        lockfileVersion: 3,
        packages: {
          "": { name: "test", version: "0.0.0" },
          "node_modules/a": { name: "a", version: "1.0.0" },
          "node_modules/a/node_modules/d": { name: "d", version: "2.0.0" },
        },
      }),
    );

    const v3deps = readLockfileDependencies(tmpDir, true);
    expect(v3deps.map((d) => d.name).sort()).toEqual(["a", "d"]);

    // v1 lockfile with nested `dependencies` tree — exercises the fallback
    // at ci.ts:106-117. The recursive `collect` must walk into `a.dependencies`
    // and pick up `d`.
    writeFileSync(
      path.join(tmpDir, "package-lock.json"),
      JSON.stringify({
        name: "test",
        version: "0.0.0",
        lockfileVersion: 1,
        dependencies: {
          a: {
            version: "1.0.0",
            dependencies: {
              d: { version: "2.0.0" },
            },
          },
        },
      }),
    );

    const v1deps = readLockfileDependencies(tmpDir, true);
    expect(v1deps.map((d) => d.name).sort()).toEqual(["a", "d"]);
  });

  // --------------------------------------------------------------------------
  // (5) prod: true filters devDependencies
  // --------------------------------------------------------------------------
  it("prod: true filters devDependencies", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-ci-"));
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test",
        version: "0.0.0",
        dependencies: { "prod-pkg": "^1.0.0" },
        devDependencies: { "dev-pkg": "^1.0.0" },
      }),
    );
    engine = new NpmSafeEngine({ dbPath: path.join(tmpDir, "test.db") });

    vi.spyOn(NpmSafeEngine.prototype, "checkPackage").mockImplementation(
      async (name: string) => makeResult(name, SecurityLevel.Safe, 90),
    );

    // Without prod: both prod and dev deps are scanned.
    const reportAll = await engine.ciScan({ dir: tmpDir });
    expect(reportAll.dependencyCount).toBe(2);
    expect(reportAll.packages.map((p) => p.name).sort()).toEqual([
      "dev-pkg",
      "prod-pkg",
    ]);

    // With prod: only prod deps are scanned.
    const reportProd = await engine.ciScan({ dir: tmpDir, prod: true });
    expect(reportProd.dependencyCount).toBe(1);
    expect(reportProd.packages.map((p) => p.name)).toEqual(["prod-pkg"]);
  });

  // --------------------------------------------------------------------------
  // (6) recordCheckHistory spy called for successful checks
  // --------------------------------------------------------------------------
  it("calls recordCheckHistory for successful checks of existing packages", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-ci-"));
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test",
        version: "0.0.0",
        dependencies: { "pkg-a": "^1.0.0", "pkg-b": "^1.0.0" },
      }),
    );
    engine = new NpmSafeEngine({ dbPath: path.join(tmpDir, "test.db") });

    vi.spyOn(NpmSafeEngine.prototype, "checkPackage").mockImplementation(
      async (name: string) => makeResult(name, SecurityLevel.Safe, 90),
    );
    const historySpy = vi.spyOn(
      NpmSafeEngine.prototype,
      "recordCheckHistory",
    );

    await engine.ciScan({ dir: tmpDir });

    // recordCheckHistory is called once per existing package (2 deps, both
    // exist in the canned results).
    expect(historySpy).toHaveBeenCalledTimes(2);
    expect(historySpy).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: "pkg-a" }),
    );
    expect(historySpy).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: "pkg-b" }),
    );
  });
});
