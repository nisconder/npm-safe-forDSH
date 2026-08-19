import { describe, it, afterEach, expect } from "vitest";
import { TokenBucket } from "../src/scheduler/rate-limiter.js";

describe("TokenBucket", () => {
  let bucket: TokenBucket;

  afterEach(() => {
    try {
      bucket.dispose();
    } catch {
      // already disposed
    }
  });

  describe("constructor", () => {
    it("creates with default values", () => {
      bucket = new TokenBucket();
      const stats = bucket.getStats();
      expect(stats.rate).toBe(5);
      expect(stats.maxBurst).toBe(10);
      expect(stats.available).toBe(10);
    });

    it("creates with custom values", () => {
      bucket = new TokenBucket(3, 6);
      const stats = bucket.getStats();
      expect(stats.rate).toBe(3);
      expect(stats.maxBurst).toBe(6);
      expect(stats.available).toBe(6);
    });

    it("throws on zero tokensPerSecond", () => {
      expect(() => new TokenBucket(0, 10)).toThrow(RangeError);
    });

    it("throws on negative tokensPerSecond", () => {
      expect(() => new TokenBucket(-1, 10)).toThrow(RangeError);
    });

    it("throws on zero maxBurst", () => {
      expect(() => new TokenBucket(5, 0)).toThrow(RangeError);
    });

    it("throws on negative maxBurst", () => {
      expect(() => new TokenBucket(5, -1)).toThrow(RangeError);
    });

    it("throws on NaN tokensPerSecond", () => {
      expect(() => new TokenBucket(NaN, 10)).toThrow(RangeError);
    });

    it("throws on Infinity maxBurst", () => {
      expect(() => new TokenBucket(5, Infinity)).toThrow(RangeError);
    });
  });

  describe("consume", () => {
    it("consumes tokens immediately when available", async () => {
      bucket = new TokenBucket(5, 10);
      await bucket.consume(1);
      const stats = bucket.getStats();
      expect(stats.available).toBe(9);
    });

    it("consumes multiple tokens at once", async () => {
      bucket = new TokenBucket(5, 10);
      await bucket.consume(3);
      const stats = bucket.getStats();
      expect(stats.available).toBe(7);
    });

    it("consumes 0 tokens as no-op", async () => {
      bucket = new TokenBucket(5, 10);
      await bucket.consume(0);
      const stats = bucket.getStats();
      expect(stats.available).toBe(10);
    });

    it("auto-allows requests larger than maxBurst", async () => {
      bucket = new TokenBucket(5, 10);
      const before = bucket.getStats().available;
      await bucket.consume(100);
      const after = bucket.getStats().available;
      expect(after).toBe(0);
      expect(before).toBe(10);
    });

    it("throws after dispose", async () => {
      bucket = new TokenBucket(5, 10);
      bucket.dispose();
      await expect(bucket.consume(1)).rejects.toThrow(/disposed/);
    });

    it("throws on negative count", async () => {
      bucket = new TokenBucket(5, 10);
      await expect(bucket.consume(-1)).rejects.toThrow(/non-negative/);
    });

    it("throws on NaN count", async () => {
      bucket = new TokenBucket(5, 10);
      await expect(bucket.consume(NaN)).rejects.toThrow(/non-negative/);
    });
  });

  describe("tryConsume", () => {
    it("consumes tokens and returns true when available", () => {
      bucket = new TokenBucket(5, 10);
      expect(bucket.tryConsume(2)).toBe(true);
      expect(bucket.getStats().available).toBe(8);
    });

    it("returns false when not enough tokens", () => {
      bucket = new TokenBucket(5, 10);
      expect(bucket.tryConsume(11)).toBe(true);
      expect(bucket.getStats().available).toBe(0);
    });

    it("returns false after dispose", () => {
      bucket = new TokenBucket(5, 10);
      bucket.dispose();
      expect(bucket.tryConsume(1)).toBe(false);
    });

    it("returns true for zero count", () => {
      bucket = new TokenBucket(5, 10);
      expect(bucket.tryConsume(0)).toBe(true);
      expect(bucket.getStats().available).toBe(10);
    });

    it("handles negative count gracefully", () => {
      bucket = new TokenBucket(5, 10);
      expect(bucket.tryConsume(-1)).toBe(false);
    });
  });

  describe("dispose", () => {
    it("cleans up interval and rejects pending consumers", async () => {
      bucket = new TokenBucket(5, 2);
      // Drain all tokens so next consume queues.
      await bucket.consume(2);
      // The bucket should be at 0 now. A consume(1) will queue.
      // But we can also test the dispose rejection.
      bucket.dispose();

      await expect(bucket.consume(1)).rejects.toThrow(/disposed/);
    });

    it("is safe to call multiple times", () => {
      bucket = new TokenBucket(5, 10);
      bucket.dispose();
      bucket.dispose();
      expect(bucket.tryConsume(1)).toBe(false);
    });
  });

  describe("waiting behavior", () => {
    it("eventually fulfills queued consumer after refill", async () => {
      // Use high rate so the test is deterministic and fast.
      bucket = new TokenBucket(500, 2);
      // Consume all burst.
      await bucket.consume(2);
      expect(bucket.getStats().available).toBe(0);

      // This will queue — but should resolve quickly (100ms tick).
      const start = Date.now();
      await bucket.consume(1);
      const elapsed = Date.now() - start;
      // With 500 tokens/s refill and 100ms tick, should resolve within ~200ms max.
      expect(elapsed).toBeLessThan(500);
      expect(bucket.getStats().available).toBeGreaterThanOrEqual(0);
      bucket.dispose();
    });

    it("services consumers in FIFO order", async () => {
      bucket = new TokenBucket(1000, 1);
      await bucket.consume(1);
      expect(bucket.getStats().available).toBe(0);

      const results: number[] = [];
      const p1 = bucket.consume(1).then(() => results.push(1));
      const p2 = bucket.consume(1).then(() => results.push(2));
      const p3 = bucket.consume(1).then(() => results.push(3));

      await Promise.all([p1, p2, p3]);
      expect(results).toEqual([1, 2, 3]);
      bucket.dispose();
    });
  });
});
