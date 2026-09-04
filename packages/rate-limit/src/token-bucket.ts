import type { Redis } from "ioredis";

/**
 * Atomic token-bucket limiter, implemented as a single Lua script so the
 * read-modify-write of "how many tokens are left, refill for elapsed time,
 * then debit one" cannot be interleaved by concurrent callers (the same
 * TOCTOU concern as the sliding-window limiter).
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerMs = tonumber(ARGV[3])
local ttlMs = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(now - ts, 0)
tokens = math.min(capacity, tokens + elapsed * refillPerMs)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, ttlMs)

return {allowed, tokens}
`;

export interface TokenBucketResult {
  allowed: boolean;
  remaining: number;
}

export class TokenBucketLimiter {
  constructor(private readonly redis: Redis, private readonly keyPrefix = "gk:rl:tb:") {}

  /** @param capacity max burst size. @param refillPerSecond steady-state
   * sustained rate. */
  async check(key: string, capacity: number, refillPerSecond: number): Promise<TokenBucketResult> {
    const now = Date.now();
    const refillPerMs = refillPerSecond / 1000;
    const ttlMs = Math.max(Math.ceil((capacity / Math.max(refillPerSecond, 0.001)) * 1000), 1000);

    const [allowed, remaining] = (await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      this.keyPrefix + key,
      now,
      capacity,
      refillPerMs,
      ttlMs,
    )) as [number, number];

    return { allowed: allowed === 1, remaining };
  }
}
