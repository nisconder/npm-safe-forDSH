import { describe, it, afterEach, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NpmSafeEngine } from "../src/index.js";
import type { PackageMetadata } from "../src/registry/types.js";

const ORIGINAL_FETCH = globalThis.fetch;

function meta(name: string, version: string, postinstall?: string): PackageMetadata {
  return {
    name,
    modified: "2026-01-01T00:00:00.000Z",
    "dist-tags": { latest: version },
    versions: {
      [version]: {
        name,
        version,
        scripts: postinstall
          ? { postinstall }
          : { test: "jest" },
        dist: { tarball: `https://example.com/${name}-${version}.tgz` },
      },
    },
    description: `Package ${name}`,
    readme: `# ${name}\n\nHarmless.`,
  };
}

describe("NpmSafeEngine.checkPackages", () => {
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
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("checks multiple packages and preserves input order", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-batch-"));
    engine = new NpmSafeEngine({
      dbPath: path.join(tmpDir, "test.db"),
      rateLimit: 1000,
      rateLimitBurst: 50,
    });

    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("safe-lib")) {
        return new Response(JSON.stringify(meta("safe-lib", "1.0.0")));
      }
      if (url.includes("other-lib")) {
        return new Response(JSON.stringify(meta("other-lib", "2.0.0")));
      }
      if (url.includes("missing-pkg")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const results = await engine.checkPackages(["safe-lib", "other-lib", "missing-pkg"], {
      concurrency: 3,
    });

    expect(results.length).toBe(3);
    expect(
      results.map((r) => r.name),
    ).toEqual(["safe-lib", "other-lib", "missing-pkg"]);
    expect(results[0].ok).toBe(true);
    expect(results[0].result?.latestVersion).toBe("1.0.0");
    expect(results[1].ok).toBe(true);
    expect(results[1].result?.latestVersion).toBe("2.0.0");
    // A 404 yields exists: false rather than an error.
    expect(results[2].ok).toBe(true);
    expect(results[2].result?.exists).toBe(false);
  });

  it("isolates network failures and reports them per package", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-batch-"));
    engine = new NpmSafeEngine({
      dbPath: path.join(tmpDir, "test.db"),
      rateLimit: 1000,
      rateLimitBurst: 50,
    });

    globalThis.fetch = (async (input: unknown) => {
      if (String(input).includes("broken")) {
        throw new Error("ECONNREFUSED");
      }
      return new Response(JSON.stringify(meta("good-lib", "1.0.0")));
    }) as typeof fetch;

    const results = await engine.checkPackages(["good-lib", "broken"], { concurrency: 2 });
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].error?.includes("ECONNREFUSED")).toBeTruthy();
  });

  it("invokes the progress callback for every completed package", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-batch-"));
    engine = new NpmSafeEngine({
      dbPath: path.join(tmpDir, "test.db"),
      rateLimit: 1000,
      rateLimitBurst: 50,
    });

    globalThis.fetch = (async (input: unknown) => {
      const name = String(input).split("/")[3] ?? "pkg";
      return new Response(JSON.stringify(meta(name, "1.0.0")));
    }) as typeof fetch;

    const calls: Array<[number, number]> = [];
    await engine.checkPackages(["a", "b", "c", "d"], {
      concurrency: 2,
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(calls.length).toBe(4);
    expect(calls[3]).toEqual([4, 4]);
  });

  it("uses cached results for packages checked before", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "npm-safe-batch-"));
    engine = new NpmSafeEngine({
      dbPath: path.join(tmpDir, "test.db"),
      rateLimit: 1000,
      rateLimitBurst: 50,
    });

    let fetches = 0;
    globalThis.fetch = (async (input: unknown) => {
      fetches++;
      return new Response(JSON.stringify(meta("cached-lib", "1.0.0")));
    }) as typeof fetch;

    await engine.checkPackages(["cached-lib"], { concurrency: 1 });
    const before = fetches;
    const second = await engine.checkPackages(["cached-lib", "cached-lib"], { concurrency: 2 });
    expect(fetches).toBe(before);
    expect(second.length).toBe(2);
    expect(second.every((r) => r.ok)).toBeTruthy();
  });
});
