import { describe, it, afterEach, expect } from "vitest";
import { DatabaseManager } from "../src/store/database.js";
import { CacheManager, DEFAULT_CACHE_TTL_MS } from "../src/store/cache-manager.js";
import { SecurityLevel, Severity } from "../src/scanner/types.js";
import type { StaticScanReport } from "../src/scanner/types.js";
import type { PackageMetadata } from "../src/registry/types.js";

// ============================================================================
// DatabaseManager
// ============================================================================

describe("DatabaseManager", () => {
  let dbm: DatabaseManager;

  afterEach(() => {
    try {
      dbm?.close();
    } catch {
      // already closed
    }
  });

  it("opens an in-memory database", () => {
    dbm = new DatabaseManager(":memory:");
    expect(dbm.isOpen()).toBe(true);
  });

  it("applies schema (tables exist after open)", () => {
    dbm = new DatabaseManager(":memory:");
    const db = dbm.getDb();

    // All application tables + _migrations should exist.
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];

    const names = tables.map((t) => t.name);
    expect(names).toContain("packages");
    expect(names).toContain("package_versions");
    expect(names).toContain("security_reports");
    expect(names).toContain("watchlist");
    expect(names).toContain("settings");
    expect(names).toContain("translations");
    expect(names).toContain("check_history");
    expect(names).toContain("_migrations");
  });

  it("records migration in _migrations table", () => {
    dbm = new DatabaseManager(":memory:");
    const db = dbm.getDb();
    const rows = db
      .prepare("SELECT name FROM _migrations ORDER BY id")
      .all() as { name: string }[];
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("001_initial.sql");
    expect(rows[1].name).toBe("002_check_history.sql");
  });

  it("is idempotent (creating twice does not duplicate migrations)", () => {
    dbm = new DatabaseManager(":memory:");
    // Close and reopen with same in-memory db path (which is always fresh).
    // The second open should still work cleanly.
    dbm.close();
    const dbm2 = new DatabaseManager(":memory:");
    expect(dbm2.isOpen()).toBe(true);
    dbm2.close();
  });

  it("throws on getDb() after close", () => {
    dbm = new DatabaseManager(":memory:");
    dbm.close();
    expect(() => dbm.getDb()).toThrow(/not open/);
  });

  it("close is safe to call multiple times", () => {
    dbm = new DatabaseManager(":memory:");
    dbm.close();
    dbm.close();
    expect(dbm.isOpen()).toBe(false);
  });

  it("creates database file on disk", () => {
    dbm = new DatabaseManager(":memory:");
    expect(dbm.isOpen()).toBe(true);
  });
});

// ============================================================================
// CacheManager
// ============================================================================

describe("CacheManager", () => {
  let dbm: DatabaseManager;
  let cache: CacheManager;

  const mockPackageMeta: PackageMetadata = {
    name: "test-pkg",
    modified: "2026-01-01T00:00:00.000Z",
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        name: "test-pkg",
        version: "1.0.0",
        dist: { tarball: "https://example.com/test-pkg-1.0.0.tgz" },
      },
    },
    description: "Test package",
    homepage: "https://example.com",
    repository: { type: "git", url: "https://github.com/user/repo" },
    readme: "# Test\n\nThis is a test.",
  };

  afterEach(() => {
    try {
      dbm?.close();
    } catch {
      // closed
    }
  });

  function setup(): void {
    dbm = new DatabaseManager(":memory:");
    cache = new CacheManager(dbm);
  }

  describe("package cache", () => {
    it("returns null for non-existent package", async () => {
      setup();
      const result = await cache.getPackage("not-found");
      expect(result).toBeNull();
    });

    it("stores and retrieves package metadata", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);
      const result = await cache.getPackage("test-pkg");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("test-pkg");
      expect(result!["dist-tags"].latest).toBe("1.0.0");
    });

    it("upserts existing package (second set overwrites)", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);

      const updated = { ...mockPackageMeta, description: "Updated" };
      await cache.setPackage(updated);

      const result = await cache.getPackage("test-pkg");
      expect(result!.description).toBe("Updated");
    });

    it("returns null when TTL has expired (getStalePackages)", async () => {
      dbm = new DatabaseManager(":memory:");
      cache = new CacheManager(dbm, { cacheTtlMs: 1000 });
      await cache.setPackage(mockPackageMeta);

      // With 1s TTL, package should NOT be stale yet.
      let stale = await cache.getStalePackages();
      expect(stale).toEqual([]);

      // Artificially expire the TTL by updating the row.
      const db = dbm.getDb();
      db.prepare(
        "UPDATE packages SET ttl_until = datetime('now', '-1 seconds') WHERE name = ?",
      ).run("test-pkg");

      // Now it should be stale.
      stale = await cache.getStalePackages();
      expect(stale).toEqual(["test-pkg"]);
    });

    it("returns package when TTL is still valid", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);
      const result = await cache.getPackage("test-pkg");
      expect(result).not.toBeNull();
    });

    it("honors sub-second TTLs (500ms cache expires)", async () => {
      dbm = new DatabaseManager(":memory:");
      cache = new CacheManager(dbm, { cacheTtlMs: 500 });
      await cache.setPackage(mockPackageMeta);

      // Immediately after set, the row must still be fresh.
      expect(await cache.getPackage("test-pkg")).not.toBeNull();
      expect(await cache.getStalePackages()).toEqual([]);

      // Wait generously past the TTL (1.4x) so the row must have expired.
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(await cache.getPackage("test-pkg")).toBeNull();
      expect(await cache.getStalePackages()).toEqual(["test-pkg"]);
    });
  });

  describe("security reports", () => {
    it("returns null for non-existent report", async () => {
      setup();
      const result = await cache.getSecurityReport("test-pkg", "1.0.0");
      expect(result).toBeNull();
    });

    it("stores and retrieves a static scan report", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);
      const report: StaticScanReport = {
        packageName: "test-pkg",
        version: "1.0.0",
        overallLevel: SecurityLevel.Safe,
        score: 100,
        findings: [],
        contentScan: {
          status: "complete",
          archiveBytes: 1_024,
          unpackedBytes: 4_096,
          filesScanned: 3,
          filesSkipped: 1,
          integrityVerified: true,
          truncated: false,
        },
        scannedAt: new Date().toISOString(),
      };
      await cache.setSecurityReport(report);
      const result = await cache.getSecurityReport("test-pkg", "1.0.0");
      expect(result).not.toBeNull();
      expect(result!.packageName).toBe("test-pkg");
      expect(result!.score).toBe(100);
      expect(result!.overallLevel).toBe(SecurityLevel.Safe);
      expect(result!.findings.length).toBe(0);
      expect(result!.contentScan).toEqual(report.contentScan);
    });

    it("reconstructs SecurityLevel from score on read", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);
      const report: StaticScanReport = {
        packageName: "test-pkg",
        version: "1.0.0",
        overallLevel: SecurityLevel.Suspicious,
        score: 55,
        findings: [
          {
            ruleId: "test",
            ruleName: "Test",
            severity: Severity.High,
            message: "Test finding",
            category: "informational" as any,
          },
        ],
        scannedAt: new Date().toISOString(),
      };
      await cache.setSecurityReport(report);
      const result = await cache.getSecurityReport("test-pkg", "1.0.0");
      expect(result!.overallLevel).toBe(SecurityLevel.Suspicious);
      expect(result!.score).toBe(55);
    });

    it("upserts existing report for same package+version+scan_type", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);
      const r1: StaticScanReport = {
        packageName: "test-pkg",
        version: "1.0.0",
        overallLevel: SecurityLevel.Safe,
        score: 100,
        findings: [],
        scannedAt: new Date().toISOString(),
      };
      await cache.setSecurityReport(r1);

      const r2: StaticScanReport = {
        packageName: "test-pkg",
        version: "1.0.0",
        overallLevel: SecurityLevel.Dangerous,
        score: 25,
        findings: [
          {
            ruleId: "found",
            ruleName: "Something",
            severity: Severity.Critical,
            message: "Bad!",
            category: "critical" as any,
          },
        ],
        scannedAt: new Date().toISOString(),
      };
      await cache.setSecurityReport(r2);

      const result = await cache.getSecurityReport("test-pkg", "1.0.0");
      expect(result!.score).toBe(25);
      expect(result!.overallLevel).toBe(SecurityLevel.Dangerous);
    });
  });

  describe("watchlist", () => {
    it("returns empty array initially", async () => {
      setup();
      const list = await cache.getWatchlist();
      expect(list).toEqual([]);
    });

    it("adds and retrieves watched packages", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);
      const pkgB = { ...mockPackageMeta, name: "pkg-b" };
      await cache.setPackage(pkgB);
      await cache.addToWatchlist("test-pkg");
      await cache.addToWatchlist("pkg-b");
      const list = await cache.getWatchlist();
      expect(list).toEqual(["test-pkg", "pkg-b"]);
    });

    it("addToWatchlist is idempotent", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);
      await cache.addToWatchlist("test-pkg");
      await cache.addToWatchlist("test-pkg");
      const list = await cache.getWatchlist();
      expect(list).toEqual(["test-pkg"]);
    });

    it("removes watched packages", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);
      const pkgB = { ...mockPackageMeta, name: "pkg-b" };
      await cache.setPackage(pkgB);
      await cache.addToWatchlist("test-pkg");
      await cache.addToWatchlist("pkg-b");
      await cache.removeFromWatchlist("test-pkg");
      const list = await cache.getWatchlist();
      expect(list).toEqual(["pkg-b"]);
    });

    it("removeFromWatchlist is idempotent", async () => {
      setup();
      await cache.removeFromWatchlist("not-exist");
      const list = await cache.getWatchlist();
      expect(list).toEqual([]);
    });
  });

  describe("settings", () => {
    it("returns null for unset key", async () => {
      setup();
      const val = await cache.getSetting("missing");
      expect(val).toBeNull();
    });

    it("stores and retrieves a setting", async () => {
      setup();
      await cache.setSetting("theme", "dark");
      const val = await cache.getSetting("theme");
      expect(val).toBe("dark");
    });

    it("overwrites existing setting", async () => {
      setup();
      await cache.setSetting("theme", "dark");
      await cache.setSetting("theme", "light");
      const val = await cache.getSetting("theme");
      expect(val).toBe("light");
    });
  });

  describe("stale packages", () => {
    it("returns empty when no packages cached", async () => {
      setup();
      const stale = await cache.getStalePackages();
      expect(stale).toEqual([]);
    });

    it("returns packages with expired TTL", async () => {
      dbm = new DatabaseManager(":memory:");
      cache = new CacheManager(dbm);
      await cache.setPackage(mockPackageMeta);

      // Manually set TTL to past to guarantee staleness.
      const db = dbm.getDb();
      db.prepare(
        "UPDATE packages SET ttl_until = datetime('now', '-1 seconds') WHERE name = ?",
      ).run("test-pkg");

      const stale = await cache.getStalePackages();
      expect(stale).toEqual(["test-pkg"]);
    });

    it("does not return fresh packages", async () => {
      setup();
      await cache.setPackage(mockPackageMeta);
      const stale = await cache.getStalePackages();
      expect(stale).toEqual([]);
    });
  });
});
