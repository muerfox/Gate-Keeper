import { describe, expect, it } from "vitest";
// @ts-expect-error -- ioredis-mock has no types package
import RedisMock from "ioredis-mock";
import { TokenBucketLimiter } from "./token-bucket.js";

describe("TokenBucketLimiter", () => {
  it("allows a burst up to capacity then denies", async () => {
    const redis = new RedisMock();
    const limiter = new TokenBucketLimiter(redis);

    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await limiter.check("k", 4, 1));
    }
    expect(results.filter((r) => r.allowed)).toHaveLength(4);
  });

  it("does not exceed capacity under concurrent requests", async () => {
    const redis = new RedisMock();
    const limiter = new TokenBucketLimiter(redis);

    const results = await Promise.all(Array.from({ length: 30 }, () => limiter.check("burst", 5, 1)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
