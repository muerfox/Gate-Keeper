import type { Redis } from "ioredis";
import { randomBytes } from "node:crypto";

/**
 * Atomic sliding-window rate limiter over a Redis sorted set.
 *
 * Each request adds a member (a unique id, scored by its timestamp) to a
 * per-key ZSET, trims members older than the window, and checks the
 * resulting cardinality against the limit — all inside one Lua script, so
 * concurrent requests against the same key cannot race between "count" and
 * "add" (the classic check-then-act TOCTOU bug that would otherwise let an
 * attacker's parallel requests all squeak in under the limit
 * simultaneously; see docs/THREAT_MODEL.md §"Prevent attackers from
 * bypassing limits through concurrency").
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetAt = now + windowMs
  if oldest[2] ~= nil then
    resetAt = tonumber(oldest[2]) + windowMs
  end
  return {0, count, resetAt}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return {1, count + 1, now + windowMs}
`;

export interface SlidingWindowResult {
  allowed: boolean;
  count: number;
  resetAt: number;
}

export class SlidingWindowLimiter {
  constructor(private readonly redis: Redis, private readonly keyPrefix = "gk:rl:sw:") {}

  async check(key: string, limit: number, windowMs: number): Promise<SlidingWindowResult> {
    const now = Date.now();
    // A random suffix keeps ZSET members unique even for requests arriving
    // in the same millisecond, which a plain timestamp member would collide
    // on and silently under-count.
    const member = `${now}:${randomBytes(6).toString("hex")}`;
    const [allowed, count, resetAt] = (await this.redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      this.keyPrefix + key,
      now,
      windowMs,
      limit,
      member,
    )) as [number, number, number];

    return { allowed: allowed === 1, count, resetAt };
  }
}
