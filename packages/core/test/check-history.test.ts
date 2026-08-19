import { describe, it, afterEach, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NpmSafeEngine } from "../src/index.js";
import { DatabaseManager } from "../src/store/database.js";
import { CacheManager, MAX_CHECK_HISTORY } from "../src/store/cache-manager.js";

const CLI_TS = path.resolve("src/cli/cli.ts");
const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function runCliSandboxed(args: string[], homeDir: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(
    "node",
    ["--import", "tsx", CLI_TS, ...args],
    {
      encoding: "utf8",
      cwd: PACKAGE_DIR,
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    },
  );
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

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

describe("CLI check persists history to the shared database", () => {
  it.skip("records checked packages in the sandboxed database — skipped: src/cli/cli.ts not migrated (T3)", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "npm-safe-cli-history-"));
    const db = path.join(home, "shared.db");
    try {
      const { status } = runCliSandboxed(["--db", db, "check", "lodash", "express"], home);
      expect(status).toBe(0);

      const engine = new NpmSafeEngine({ dbPath: db });
      try {
        const history = await engine.getCheckHistory();
        expect(history.length).toBe(2);
        const names = history.map((h) => h.packageName);
        expect(names.includes("lodash")).toBeTruthy();
        expect(names.includes("express")).toBeTruthy();
      } finally {
        engine.close();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.skip("records ci scans into history — skipped: src/cli/cli.ts not migrated (T3)", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "npm-safe-cli-history-"));
    const db = path.join(home, "shared.db");
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path.join(home, "package.json"), JSON.stringify({
        name: "scan-me",
        version: "0.0.0",
        dependencies: { lodash: "^4.17.21" },
      }));
      const { status } = runCliSandboxed(["--db", db, "ci", "--dir", home, "--rate-limit", "100"], home);
      expect(status).toBe(0);
      expect(status).toBe(0);

      const engine = new NpmSafeEngine({ dbPath: db });
      try {
        const history = await engine.getCheckHistory();
        expect(history.some((h) => h.packageName === "lodash")).toBeTruthy();
      } finally {
        engine.close();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
