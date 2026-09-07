import type { Redis } from "ioredis";

export interface ReplayStore {
  /** Atomically marks `key` as consumed. Returns true iff THIS call is the
   * one that consumed it (i.e., it was not already consumed) — the core
   * one-time-use guarantee described in docs/ARCHITECTURE.md §Replay
   * Protection. Must be safe under concurrent/parallel calls with the same
   * key. */
  consume(key: string, ttlSeconds: number, metadata?: string): Promise<boolean>;
}

/**
 * Redis-backed replay store (primary implementation).
 *
 * `SET key value NX EX ttl` is a single Redis command, and Redis executes
 * commands one at a time per shard/slot — there is no window in which two
 * concurrent `consume()` calls for the same key can both observe "not yet
 * set." Exactly one caller receives `OK` from `SET ... NX`; every other
 * caller (including simultaneous ones from other API processes) receives
 * `null`. This holds across a Redis Cluster too, since NX/EX on a single
 * key never spans multiple hash slots.
 */
export class RedisReplayStore implements ReplayStore {
  constructor(private readonly redis: Redis, private readonly keyPrefix = "gk:consumed:") {}

  async consume(key: string, ttlSeconds: number, metadata = "1"): Promise<boolean> {
    const result = await this.redis.set(this.keyPrefix + key, metadata, "EX", ttlSeconds, "NX");
    return result === "OK";
  }
}

/** Minimal shape of the Prisma delegate this store needs — kept narrow so
 * apps/api can pass its real PrismaClient without this package depending on
 * @gatekeeper/shared's generated client directly. */
export interface ConsumedTokenDelegate {
  create(args: { data: { jti: string; siteId: string; action: string; consumerIp?: string | null } }): Promise<unknown>;
}

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * PostgreSQL fallback replay store, used automatically when Redis is
 * unavailable and the site's failure policy is `fail_open` for rate
 * limiting but the one-time-token guarantee must still hold (see
 * docs/ARCHITECTURE.md §Failure Modes). Atomicity comes from the unique
 * constraint on `consumed_tokens.jti`: the database itself rejects a second
 * INSERT for the same key, so this is race-free under concurrent requests
 * for the same reason a Redis `SET NX` is — the storage engine serializes
 * the conflicting writes, not application code.
 */
export class PostgresReplayStore implements ReplayStore {
  constructor(
    private readonly consumedTokens: ConsumedTokenDelegate,
    private readonly parseKey: (key: string) => { siteId: string; action: string },
  ) {}

  async consume(key: string): Promise<boolean> {
    const { siteId, action } = this.parseKey(key);
    try {
      await this.consumedTokens.create({ data: { jti: key, siteId, action } });
      return true;
    } catch (err) {
      if (isUniqueConstraintError(err)) return false;
      throw err;
    }
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION;
}

/**
 * Composes Redis (fast path) with the Postgres fallback: tries Redis first;
 * if Redis is unreachable, falls back to Postgres so the one-time-use
 * invariant is preserved even during a Redis outage, and reports the
 * degradation via `onDegraded` so it is logged as a security event rather
 * than silently absorbed (docs/THREAT_MODEL.md §4.11, §7).
 */
export class FailoverReplayStore implements ReplayStore {
  constructor(
    private readonly primary: ReplayStore,
    private readonly fallback: ReplayStore,
    private readonly onDegraded: (err: unknown) => void,
  ) {}

  async consume(key: string, ttlSeconds: number, metadata?: string): Promise<boolean> {
    try {
      return await this.primary.consume(key, ttlSeconds, metadata);
    } catch (err) {
      this.onDegraded(err);
      return this.fallback.consume(key, ttlSeconds, metadata);
    }
  }
}
