import { Redis, type RedisOptions } from "ioredis";

/** Single shared factory so every caller gets the same conservative
 * connection behavior: bounded retry/backoff (never hang forever waiting
 * for Redis — callers need to hit their fail-open/fail-closed policy
 * promptly, see docs/ARCHITECTURE.md §Failure Modes), and a command
 * timeout so a half-open TCP connection can't stall a verify request. */
export function createRedisClient(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 1,
    commandTimeout: 750,
    retryStrategy(times) {
      return Math.min(times * 200, 2000);
    },
    ...options,
  });
}

export type { Redis };
