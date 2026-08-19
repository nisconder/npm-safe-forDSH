import { describe, it, afterEach, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NpmSafeEngine } from "../src/index.js";
import { DatabaseManager } from "../src/store/database.js";
import { CacheManager, MAX_CHECK_HISTORY } from "../src/store/cache-manager.js";

describe("check history", () => {
  let tmpDir: string;
  let engine: NpmSafeEngine;

  afterEach(() => {
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

  it("records, reads, and clears history via the engine", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-history-"));
    engine = new NpmSafeEngine({ dbPath: path.join(tmpDir, "test.db") });

    const result = {
      exists: true,
      packageName: "demo",
      security: { overallLevel: "safe", overallScore: 97 },
    } as unknown as Parameters<NpmSafeEngine["recordCheckHistory"]>[0];
    await engine.recordCheckHistory(result);

    const history = await engine.getCheckHistory();
    expect(history.length).toBe(1);
    expect(history[0].packageName).toBe("demo");
    expect(history[0].level).toBe("safe");
    expect(history[0].score).toBe(97);
    expect(history[0].timestamp).toBeTruthy();

    await engine.clearCheckHistory();
    expect((await engine.getCheckHistory()).length).toBe(0);
  });

  it("does not record non-existent packages", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-history-"));
    engine = new NpmSafeEngine({ dbPath: path.join(tmpDir, "test.db") });

    await engine.recordCheckHistory({ exists: false } as unknown as Parameters<NpmSafeEngine["recordCheckHistory"]>[0]);
    expect((await engine.getCheckHistory()).length).toBe(0);
  });

  it("retains only the newest MAX_CHECK_HISTORY entries", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-history-"));
    engine = new NpmSafeEngine({ dbPath: path.join(tmpDir, "test.db") });

    for (let i = 0; i < MAX_CHECK_HISTORY + 50; i++) {
      await engine.recordHistoryEntry({
        packageName: `pkg-${i}`,
        level: "safe",
        score: 90,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      });
    }
    const history = await engine.getCheckHistory();
    expect(history.length).toBe(MAX_CHECK_HISTORY);
    // Newest first: the last recorded entry should be at the top.
    expect(history[0].packageName).toBe(`pkg-${MAX_CHECK_HISTORY + 49}`);
  });

  it("migrates legacy history.json into the database", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-history-"));
    const legacy = path.join(tmpDir, "legacy.json");
    writeFileSync(legacy, JSON.stringify([
      { packageName: "old-lib", level: "dangerous", score: 30, timestamp: "2026-01-01T00:00:00.000Z" },
      { packageName: "old-2", level: "safe", score: 95, timestamp: "2026-01-02T00:00:00.000Z" },
    ]));

    const dbm = new DatabaseManager(path.join(tmpDir, "test.db"));
    try {
      const cache = new CacheManager(dbm);
      // Simulate the extension's migration: read legacy file, write to DB.
      const legacyEntries = JSON.parse(readFileSync(legacy, "utf8")) as Array<{
        packageName: string;
        level: string;
        score: number;
        timestamp: string;
      }>;
      for (const entry of legacyEntries) {
        await cache.addHistoryEntry({
          packageName: entry.packageName,
          level: entry.level,
          score: entry.score,
          timestamp: entry.timestamp,
        });
      }
      const history = await cache.getHistory();
      expect(history.length).toBe(2);
      // Newest first.
      expect(history[0].packageName).toBe("old-2");
    } finally {
      dbm.close();
    }
  });
});
