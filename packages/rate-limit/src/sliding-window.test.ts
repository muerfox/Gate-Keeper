import { describe, expect, it } from "vitest";
// @ts-expect-error -- ioredis-mock has no types package
import RedisMock from "ioredis-mock";
import { SlidingWindowLimiter } from "./sliding-window.js";

describe("SlidingWindowLimiter", () => {
  it("allows requests up to the limit and denies beyond it", async () => {
    const redis = new RedisMock();
    const limiter = new SlidingWindowLimiter(redis);

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await limiter.check("k", 3, 60_000));
    }

    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(results.filter((r) => !r.allowed)).toHaveLength(2);
  });

  it("keeps independent counters per key", async () => {
    const redis = new RedisMock();
    const limiter = new SlidingWindowLimiter(redis);

    expect((await limiter.check("a", 1, 60_000)).allowed).toBe(true);
    expect((await limiter.check("b", 1, 60_000)).allowed).toBe(true);
    expect((await limiter.check("a", 1, 60_000)).allowed).toBe(false);
  });

  it("does not allow more than the limit under concurrent requests (no TOCTOU race)", async () => {
    const redis = new RedisMock();
    const limiter = new SlidingWindowLimiter(redis);

    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.check("burst", 5, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
