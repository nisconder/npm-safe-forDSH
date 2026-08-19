/**
 * Tests for the T7 engine-options contract: `forceRefresh` and cooperative
 * `signal` threading across `checkPackage`, `searchPackages`, `checkPackages`,
 * `refreshPackage`/`refreshAll`, and the LLM scan path.
 *
 * These tests are network-free: the registry client and LLM providers are
 * stubbed via `vi.spyOn` / `globalThis.fetch` mocks. The cooperative
 * cancellation contract is asserted for real — abort errors must surface as
 * `DOMException` with `name === 'AbortError'` (not merely "any rejection"),
 * and the registry retry loop must NOT retry an external abort.
 */

import { describe, it, afterEach, expect, vi } from "vitest";
import { NpmSafeEngine } from "../src/index.js";
import { NpmRegistryClient } from "../src/registry/client.js";
import { CacheManager } from "../src/store/cache-manager.js";
import { DatabaseManager } from "../src/store/database.js";
import { TokenBucket } from "../src/scheduler/rate-limiter.js";
import { StaticAnalyzer } from "../src/scanner/static-rules.js";
import { RefreshScheduler } from "../src/scheduler/refresh-scheduler.js";
import type { PackageMetadata } from "../src/registry/types.js";

const ORIGINAL_FETCH = globalThis.fetch;

/**
 * A benign package metadata document used as the "fresh" registry payload.
 */
const freshMeta: PackageMetadata = {
  name: "test-pkg",
  modified: "2026-01-01T00:00:00.000Z",
  "dist-tags": { latest: "2.0.0" },
  versions: {
    "2.0.0": {
      name: "test-pkg",
      version: "2.0.0",
      scripts: { build: "tsc" },
      dist: { tarball: "https://registry.npmjs.org/test-pkg/-/test-pkg-2.0.0.tgz" },
    },
  },
  description: "Fresh from the registry",
  readme: "# test-pkg\n\nHarmless.",
};

/**
 * A stale-looking metadata document used as the "cached" value. Its
 * description and version differ from {@link freshMeta} so a test can tell
 * which source produced a {@link CheckResult}.
 */
const cachedMeta: PackageMetadata = {
  name: "test-pkg",
  modified: "2025-01-01T00:00:00.000Z",
  "dist-tags": { latest: "1.0.0" },
  versions: {
    "1.0.0": {
      name: "test-pkg",
      version: "1.0.0",
      scripts: { build: "tsc" },
      dist: { tarball: "https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz" },
    },
  },
  description: "Stale cached value",
  readme: "# test-pkg\n\nHarmless.",
};

/**
 * Build a fresh `Response`-like object without touching the network.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Return a `DOMException` abort error in the shape `fetch` produces.
 */
function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Install a `globalThis.fetch` mock that never resolves until its request
 * signal aborts, then rejects with `AbortError`. Used to simulate an
 * in-flight request that is cancelled mid-flight.
 */
function fetchHangsUntilAborted(): void {
  globalThis.fetch = ((_url: unknown, init?: unknown) => {
    return new Promise((_resolve, reject) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      signal?.addEventListener(
        "abort",
        () => reject(abortError()),
        { once: true },
      );
      // Otherwise never resolves — simulates a hung server.
    });
  }) as typeof fetch;
}

describe("NpmSafeEngine check/refresh options (forceRefresh + signal)", () => {
  let engine: NpmSafeEngine;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = ORIGINAL_FETCH;
    try {
      engine?.close();
    } catch {
      /* ignore */
    }
  });

  // --------------------------------------------------------------------------
  // (1) forceRefresh skips the cache-hit fast path
  // --------------------------------------------------------------------------
  it("forceRefresh skips the cache and fetches from the registry", async () => {
    // Spy on the registry fetch so no real network call is made. Returns the
    // fresh metadata regardless of input.
    const metaSpy = vi
      .spyOn(NpmRegistryClient.prototype, "getPackageMetadata")
      .mockResolvedValue(freshMeta);

    // Spy on the cache read so it claims a cached value exists. With
    // forceRefresh the engine must NOT consult the cache at all.
    const cacheSpy = vi
      .spyOn(CacheManager.prototype, "getPackage")
      .mockResolvedValue(cachedMeta);

    engine = new NpmSafeEngine({ dbPath: ":memory:" });

    const result = await engine.checkPackage("test-pkg", {
      forceRefresh: true,
    });

    // The registry fetch WAS invoked — forceRefresh bypassed the cache.
    expect(metaSpy).toHaveBeenCalledTimes(1);
    // The cache-hit fast path was skipped entirely — getPackage was never
    // called, so the stale cached value could not be served.
    expect(cacheSpy).not.toHaveBeenCalled();
    // The result reflects the fresh registry payload, NOT the cached value.
    expect(result.exists).toBe(true);
    expect(result.latestVersion).toBe("2.0.0");
    expect(result.registryInfo?.description).toBe("Fresh from the registry");
  });

  // --------------------------------------------------------------------------
  // (2) Already-aborted signal: rejects with AbortError, no retry
  // --------------------------------------------------------------------------
  it("an already-aborted signal rejects with AbortError and does not retry", async () => {
    // Count fetch calls to prove the retry loop does NOT iterate 3× on an
    // external abort. The registry client's `request` must break the loop
    // and rethrow AbortError instead of wrapping it as a retryable timeout.
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      // Simulate the fetch aborting: abort the external controller and
      // reject with AbortError. This exercises the catch-branch fix (the
      // external signal is now aborted → break + rethrow, no retry).
      controller.abort();
      return Promise.reject(abortError());
    }) as typeof fetch;

    // Spy without mocking so the real `request` retry logic runs.
    const metaSpy = vi.spyOn(
      NpmRegistryClient.prototype,
      "getPackageMetadata",
    );

    engine = new NpmSafeEngine({ dbPath: ":memory:" });

    const controller = new AbortController();
    const promise = engine.checkPackage("test-pkg", {
      signal: controller.signal,
    });

    let caught: unknown = null;
    try {
      await promise;
      expect.unreachable("should have rejected with AbortError");
    } catch (err) {
      caught = err;
    }

    // The rejection is specifically an AbortError DOMException — NOT a
    // wrapped NpmRegistryError "timed out" (which is what the old retry
    // loop would have produced).
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");

    // getPackageMetadata was called at most once by the engine (no retry
    // observable at this layer).
    expect(metaSpy.mock.calls.length).toBeLessThanOrEqual(1);
    // The underlying fetch was called at most once — proving the retry loop
    // broke on the external abort instead of retrying up to MAX_ATTEMPTS (3).
    expect(fetchCalls).toBeLessThanOrEqual(1);
  });

  // --------------------------------------------------------------------------
  // (3) Abort during refreshAll: the scheduler propagates the signal
  // --------------------------------------------------------------------------
  it("refreshAll({ signal }) rejects with AbortError when aborted mid-flight", async () => {
    let dbm: DatabaseManager | undefined;
    let limiter: TokenBucket | undefined;
    let scheduler: RefreshScheduler | undefined;

    try {
      // A 1ms TTL ensures the cached package is stale by the time refreshAll
      // reads the stale set, so there is one package to refresh.
      dbm = new DatabaseManager(":memory:");
      const cache = new CacheManager(dbm, { cacheTtlMs: 1 });
      const client = new NpmRegistryClient({
        baseUrl: "https://registry.npmjs.org",
      });
      limiter = new TokenBucket(100, 50);
      const analyzer = new StaticAnalyzer();
      scheduler = new RefreshScheduler(client, cache, limiter, analyzer);

      await cache.setPackage(freshMeta);
      // Allow the 1ms TTL to elapse so getStalePackages returns the row.
      await new Promise((r) => setTimeout(r, 10));

      // The registry fetch hangs until the signal aborts, then rejects with
      // AbortError — simulating an in-flight refresh that is cancelled.
      fetchHangsUntilAborted();

      const controller = new AbortController();
      const promise = scheduler.refreshAll({ signal: controller.signal });

      // Let the refresh start: getStalePackages → refreshPackage → fetch.
      await new Promise((r) => setTimeout(r, 50));
      controller.abort();

      let caught: unknown = null;
      try {
        await promise;
        expect.unreachable("refreshAll should have rejected with AbortError");
      } catch (err) {
        caught = err;
      }

      // The scheduler propagated the abort as AbortError (instead of the
      // usual `false` return for per-package failures), proving the signal
      // is threaded through refreshPackage → client.getPackageMetadata and
      // rethrown from the catch on external abort.
      expect(caught).toBeInstanceOf(DOMException);
      expect((caught as DOMException).name).toBe("AbortError");
    } finally {
      try {
        scheduler?.stop();
      } catch {
        /* ignore */
      }
      try {
        limiter?.dispose();
      } catch {
        /* ignore */
      }
      try {
        dbm?.close();
      } catch {
        /* ignore */
      }
    }
  });

  // --------------------------------------------------------------------------
  // (4) LLM abort: an in-flight LLM scan settles promptly on abort
  // --------------------------------------------------------------------------
  it("an in-flight LLM scan rejects with AbortError when the signal aborts", async () => {
    // Registry metadata resolves immediately; the LLM chat/completions call
    // hangs until the signal aborts, then rejects with AbortError.
    globalThis.fetch = ((url: unknown, init?: unknown) => {
      const u = String(url);
      if (u.includes("chat/completions")) {
        return new Promise((_resolve, reject) => {
          const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(abortError()),
            { once: true },
          );
          // Otherwise never resolves — simulates a hung LLM endpoint.
        });
      }
      return Promise.resolve(jsonResponse(freshMeta));
    }) as typeof fetch;

    engine = new NpmSafeEngine({
      dbPath: ":memory:",
      llm: { apiKey: "test-key", baseUrl: "https://llm.example/v1" },
    });

    const controller = new AbortController();
    const promise = engine.checkPackage("test-pkg", {
      signal: controller.signal,
    });

    // Let the registry metadata resolve and the LLM scan start.
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    let caught: unknown = null;
    try {
      await promise;
      expect.unreachable("checkPackage should have rejected with AbortError");
    } catch (err) {
      caught = err;
    }

    // The abort propagated through the LLM provider → scanWithLlm →
    // checkPackage as AbortError, proving the signal is threaded into the
    // LLM path and an in-flight scan settles promptly on abort.
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");
  });

  // --------------------------------------------------------------------------
  // (5) searchPackages accepts the { size, signal } options object
  // --------------------------------------------------------------------------
  it("searchPackages accepts an options object with size and signal", async () => {
    const searchResponse = {
      objects: [
        {
          package: {
            name: "test-pkg",
            scope: "",
            version: "2.0.0",
            date: "2026-01-01T00:00:00.000Z",
            links: {
              npm: "https://www.npmjs.com/package/test-pkg",
            },
            publisher: { username: "dev", email: "dev@example.com" },
            maintainers: [],
          },
          score: {
            final: 0.8,
            detail: { quality: 0.9, popularity: 0.7, maintenance: 0.8 },
          },
        },
      ],
    };

    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse(searchResponse))) as typeof fetch;

    engine = new NpmSafeEngine({ dbPath: ":memory:" });

    // The size option is honoured (assertion on the returned count stays
    // unchanged from the original positional-arg behaviour).
    const results = await engine.searchPackages("test", { size: 5 });
    expect(results.length).toBe(1);
    expect(results[0].package.name).toBe("test-pkg");

    // The signal is forwarded and honoured: an already-aborted signal makes
    // searchPackages reject with AbortError via the registry client's
    // top-of-loop abort check (proving the signal reaches `request`).
    const controller = new AbortController();
    controller.abort();
    await expect(
      engine.searchPackages("test", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
