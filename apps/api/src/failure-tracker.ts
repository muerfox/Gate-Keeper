import type { Redis } from "ioredis";

const WINDOW_SECONDS = 300;
const KEY_PREFIX = "gk:failures:";

/** Tracks recent failed-verification counts per (site, ip) as an input to
 * the risk engine's `recentFailureCount` signal. This is a soft,
 * informational counter — not itself a rate limiter or an enforcement
 * mechanism (that's packages/rate-limit) — so a benign race between "read
 * current count" and "increment" only affects risk scoring precision, not
 * a security boundary. */
export class FailureTracker {
  constructor(private readonly redis: Redis) {}

  async peek(siteId: string, ip: string): Promise<number> {
    const raw = await this.redis.get(`${KEY_PREFIX}${siteId}:${ip}`);
    return raw ? Number(raw) : 0;
  }

  async recordFailure(siteId: string, ip: string): Promise<void> {
    const key = `${KEY_PREFIX}${siteId}:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
  }
}
