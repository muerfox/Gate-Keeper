import { describe, expect, it } from "vitest";
// @ts-expect-error -- ioredis-mock has no types package
import RedisMock from "ioredis-mock";
import { RedisReplayStore } from "./replay-store.js";

describe("RedisReplayStore", () => {
  it("consumes a token exactly once", async () => {
    const redis = new RedisMock();
    const store = new RedisReplayStore(redis);

    expect(await store.consume("token-1", 60)).toBe(true);
    expect(await store.consume("token-1", 60)).toBe(false);
    expect(await store.consume("token-1", 60)).toBe(false);
  });

  it("allows different tokens independently", async () => {
    const redis = new RedisMock();
    const store = new RedisReplayStore(redis);

    expect(await store.consume("token-a", 60)).toBe(true);
    expect(await store.consume("token-b", 60)).toBe(true);
  });

  it("exactly one winner under concurrent/parallel consumption of the same token", async () => {
    const redis = new RedisMock();
    const store = new RedisReplayStore(redis);

    const results = await Promise.all(Array.from({ length: 25 }, () => store.consume("race-token", 60)));
    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
  });
});
