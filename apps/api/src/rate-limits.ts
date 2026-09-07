import type { Redis } from "ioredis";
import { CompositeRateLimiter, SlidingWindowLimiter, TokenBucketLimiter, type RateLimitRule } from "@gatekeeper/rate-limit";

/**
 * Default composite rate-limit rules for the public challenge/verify
 * endpoints. Every rule fires independently (docs spec: "Implement
 * multiple levels: IP / site / action / session / challenge / token / API
 * key") so an attacker cannot dodge the limit by only varying one
 * dimension (e.g. rotating IPs still trips the per-site and per-action
 * limits; a single session hammering one action still trips the
 * per-session limit even from a clean IP).
 */
export function buildDefaultRules(): RateLimitRule[] {
  return [
    {
      name: "ip",
      dimension: (ctx) => ctx.ip,
      algorithm: { kind: "sliding_window", limit: 60, windowMs: 60_000 },
    },
    {
      name: "site",
      dimension: (ctx) => ctx.siteId,
      algorithm: { kind: "sliding_window", limit: 600, windowMs: 60_000 },
    },
    {
      name: "site_action",
      dimension: (ctx) => (ctx.siteId && ctx.action ? `${ctx.siteId}:${ctx.action}` : undefined),
      algorithm: { kind: "sliding_window", limit: 300, windowMs: 60_000 },
    },
    {
      name: "session",
      dimension: (ctx) => ctx.sessionId,
      algorithm: { kind: "sliding_window", limit: 20, windowMs: 60_000 },
    },
    {
      name: "api_key",
      dimension: (ctx) => ctx.apiKeyId,
      algorithm: { kind: "token_bucket", capacity: 100, refillPerSecond: 10 },
    },
  ];
}

export function createDefaultRateLimiter(redis: Redis): CompositeRateLimiter {
  return new CompositeRateLimiter(new SlidingWindowLimiter(redis), new TokenBucketLimiter(redis), buildDefaultRules());
}
