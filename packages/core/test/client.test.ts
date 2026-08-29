import { describe, it, afterEach, expect } from "vitest";
import { NpmRegistryClient } from "../src/registry/client.js";
import { NpmRegistryError } from "../src/registry/types.js";
import type { PackageMetadata } from "../src/registry/types.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

const mockPackageMeta: PackageMetadata = {
  name: "test-pkg",
  modified: "2026-01-01T00:00:00.000Z",
  "dist-tags": { latest: "1.0.0" },
  versions: {
    "1.0.0": {
      name: "test-pkg",
      version: "1.0.0",
      scripts: { build: "tsc" },
      dist: { tarball: "https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz" },
    },
  },
  description: "A test package",
};

function mockFetch(
  status: number,
  body: unknown,
  opts?: { headers?: Record<string, string> },
): void {
  globalThis.fetch = ((_url: unknown, _init?: unknown) => {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 404 ? "Not Found" : status === 500 ? "Server Error" : "OK",
      headers: new Map(Object.entries(opts?.headers ?? {})),
      json: () => Promise.resolve(body),
    });
  }) as typeof fetch;
}

function mockFetchReject(error: Error): void {
  globalThis.fetch = (() => Promise.reject(error)) as typeof fetch;
}

describe("NpmRegistryClient", () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  describe("constructor", () => {
    it("defaults to registry.npmjs.org", () => {
      const client = new NpmRegistryClient();
    });

    it("accepts custom base URL", () => {
      const client = new NpmRegistryClient({
        baseUrl: "https://custom.registry/",
      });
    });

    it("strips trailing slash from base URL", () => {
      const client = new NpmRegistryClient({
        baseUrl: "https://registry.npmjs.org/",
      });
    });
  });

  describe("getPackageMetadata", () => {
    it("returns parsed metadata on success", async () => {
      mockFetch(200, mockPackageMeta);
      const client = new NpmRegistryClient();
      const result = await client.getPackageMetadata("test-pkg");
      expect(result.name).toBe("test-pkg");
      expect(result["dist-tags"].latest).toBe("1.0.0");
    });

    it("retries and succeeds on transient failure", async () => {
      let callCount = 0;
      globalThis.fetch = ((_url: unknown, _init?: unknown) => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: "Service Unavailable",
            json: () => Promise.resolve({}),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(mockPackageMeta),
        });
      }) as typeof fetch;

      const client = new NpmRegistryClient();
      const result = await client.getPackageMetadata("test-pkg");
      expect(result.name).toBe("test-pkg");
      expect(callCount).toBe(3);
    });

    it("throws NpmRegistryError after all retries exhausted", async () => {
      mockFetch(500, { error: "internal" });
      const client = new NpmRegistryClient();

      try {
        await client.getPackageMetadata("test-pkg");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NpmRegistryError);
        expect(
          (err as NpmRegistryError).message.includes("500"),
        ).toBe(true);
      }
    });

    it("throws NpmRegistryError on network failure", async () => {
      mockFetchReject(new Error("Network error"));
      const client = new NpmRegistryClient();

      try {
        await client.getPackageMetadata("test-pkg");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NpmRegistryError);
        expect(
          (err as NpmRegistryError).message.includes("attempts"),
        ).toBe(true);
      }
    });
  });

  describe("searchPackages", () => {
    it("returns normalized search results", async () => {
      const searchResponse = {
        objects: [
          {
            package: {
              name: "test-pkg",
              scope: "",
              version: "1.0.0",
              date: "2026-01-01T00:00:00.000Z",
              links: {
                npm: "https://www.npmjs.com/package/test-pkg",
                homepage: "https://example.com",
                repository: "https://github.com/user/repo",
              },
              publisher: { username: "dev", email: "dev@example.com" },
              maintainers: [{ username: "dev", email: "dev@example.com" }],
            },
            score: {
              final: 0.8,
              detail: { quality: 0.9, popularity: 0.7, maintenance: 0.8 },
            },
          },
        ],
      };

      mockFetch(200, searchResponse);
      const client = new NpmRegistryClient();
      const results = await client.searchPackages("test", { size: 5 });

      expect(results.length).toBe(1);
      expect(results[0].package.name).toBe("test-pkg");
      expect(results[0].searchScore).toBe(0.8);
    });

    it("falls back to final score when searchScore is absent", async () => {
      const searchResponse = {
        objects: [
          {
            package: {
              name: "test-pkg",
              scope: "",
              version: "1.0.0",
              date: "2026-01-01T00:00:00.000Z",
              links: {
                npm: "https://www.npmjs.com/package/test-pkg",
              },
              publisher: { username: "dev", email: "dev@example.com" },
              maintainers: [],
            },
            score: {
              final: 0.75,
              detail: { quality: 0.8, popularity: 0.7, maintenance: 0.7 },
            },
          },
        ],
      };

      mockFetch(200, searchResponse);
      const client = new NpmRegistryClient();
      const results = await client.searchPackages("test");

      expect(results[0].searchScore).toBe(0.75);
    });
  });

  describe("downloadTarball", () => {
    it("downloads a same-origin tarball with binary-safe request options", async () => {
      const payload = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(new Response(payload, { status: 200 }));
      }) as typeof fetch;

      const client = new NpmRegistryClient();
      const result = await client.downloadTarball(
        "https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz",
      );

      expect(result).toEqual(payload);
      expect(capturedInit?.redirect).toBe("error");
      expect(capturedInit?.headers).toEqual({
        Accept: "application/octet-stream",
        "Accept-Encoding": "identity",
        "User-Agent": "@npm-safe/core (https://npmjs.org)",
      });
    });

    it("refuses cross-origin tarball URLs before making a request", async () => {
      let called = false;
      globalThis.fetch = (() => {
        called = true;
        return Promise.resolve(new Response());
      }) as typeof fetch;

      const client = new NpmRegistryClient();
      await expect(
        client.downloadTarball("https://attacker.example/package.tgz"),
      ).rejects.toThrow(/does not match registry origin/);
      expect(called).toBe(false);
    });

    it("enforces the compressed size limit before buffering the body", async () => {
      globalThis.fetch = (() => Promise.resolve(new Response("small", {
        status: 200,
        headers: { "content-length": "1000" },
      }))) as typeof fetch;

      const client = new NpmRegistryClient();
      await expect(client.downloadTarball(
        "https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz",
        { maxBytes: 10 },
      )).rejects.toThrow(/download limit/);
    });
  });

  describe("proxy support", () => {
    it("passes a dispatcher when proxy env var is set", async () => {
      process.env.HTTPS_PROXY = "http://127.0.0.1:7897";
      process.env.NO_PROXY = "";

      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(mockPackageMeta),
        });
      }) as typeof fetch;

      const client = new NpmRegistryClient();
      await client.getPackageMetadata("test-pkg");

      const dispatcher = (capturedInit as { dispatcher?: unknown } | undefined)?.dispatcher;
      expect(dispatcher).toBeTruthy();
    });

    it("bypasses proxy for hosts listed in NO_PROXY", async () => {
      process.env.HTTPS_PROXY = "http://127.0.0.1:7897";
      process.env.NO_PROXY = "registry.npmjs.org";

      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(mockPackageMeta),
        });
      }) as typeof fetch;

      const client = new NpmRegistryClient();
      await client.getPackageMetadata("test-pkg");

      const dispatcher = (capturedInit as { dispatcher?: unknown } | undefined)?.dispatcher;
      expect(dispatcher).toBeUndefined();
    });

    it("respects explicit proxy option over env vars", async () => {
      process.env.HTTPS_PROXY = "http://env-proxy:8080";
      process.env.NO_PROXY = "";

      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(mockPackageMeta),
        });
      }) as typeof fetch;

      const client = new NpmRegistryClient({
        proxy: "http://explicit-proxy:3128",
      });
      await client.getPackageMetadata("test-pkg");

      const dispatcher = (capturedInit as { dispatcher?: unknown } | undefined)?.dispatcher;
      expect(dispatcher).toBeTruthy();
    });

    it("uses no dispatcher when no proxy is configured", async () => {
      delete process.env.HTTPS_PROXY;
      delete process.env.HTTP_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.https_proxy;
      delete process.env.http_proxy;
      delete process.env.all_proxy;
      process.env.NO_PROXY = "";

      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(mockPackageMeta),
        });
      }) as typeof fetch;

      const client = new NpmRegistryClient();
      await client.getPackageMetadata("test-pkg");

      const dispatcher = (capturedInit as { dispatcher?: unknown } | undefined)?.dispatcher;
      expect(dispatcher).toBeUndefined();
    });
  });
});
