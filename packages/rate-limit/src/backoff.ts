import type { Redis } from "ioredis";

/** Exponential backoff after repeated failures (admin login attempts,
 * repeated challenge failures from one session, etc.). Distinct from the
 * rate limiters above: this tracks *failures*, not raw request volume, and
 * the lockout duration grows with each consecutive failure rather than
 * resetting on a fixed window. */
export interface BackoffState {
  failureCount: number;
  lockedUntil: number | null;
}

const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local ttlSeconds = tonumber(ARGV[2])

local count = redis.call('INCR', key)
redis.call('EXPIRE', key, ttlSeconds)
return count
`;

export class ExponentialBackoff {
  constructor(
    private readonly redis: Redis,
    private readonly options: { baseSeconds: number; maxSeconds: number; resetAfterSeconds: number } = {
      baseSeconds: 1,
      maxSeconds: 900,
      resetAfterSeconds: 3600,
    },
    private readonly keyPrefix = "gk:backoff:",
  ) {}

  private delayForCount(count: number): number {
    if (count <= 1) return 0;
    const delay = this.options.baseSeconds * 2 ** (count - 2);
    return Math.min(delay, this.options.maxSeconds);
  }

  /** Records a failure and returns how many seconds the caller must wait
   * before the next attempt is allowed. */
  async recordFailure(key: string): Promise<{ failureCount: number; retryAfterSeconds: number }> {
    const count = (await this.redis.eval(
      SCRIPT,
      1,
      this.keyPrefix + key,
      Date.now(),
      this.options.resetAfterSeconds,
    )) as number;
    return { failureCount: count, retryAfterSeconds: this.delayForCount(count) };
  }

  async currentRetryAfterSeconds(key: string): Promise<number> {
    const raw = await this.redis.get(this.keyPrefix + key);
    if (!raw) return 0;
    return this.delayForCount(Number(raw));
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.keyPrefix + key);
  }
}
