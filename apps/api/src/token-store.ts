import type { Redis } from "ioredis";
import { FailoverReplayStore, PostgresReplayStore, RedisReplayStore, type ReplayStore } from "@gatekeeper/rate-limit";
import type { PrismaClient } from "./db.js";
import type { SecurityEventLogger } from "./security-events.js";

/** The verification-token replay store: Redis is the fast path, Postgres
 * (via the `consumed_tokens` unique constraint) is the durable fallback so
 * the one-time-use guarantee survives a Redis outage
 * (docs/ARCHITECTURE.md §Failure Modes). Every fallback activation is
 * logged as a REDIS_DEGRADED security event — degradation is never silent. */
export function createTokenReplayStore(redis: Redis, db: PrismaClient, logSecurityEvent: SecurityEventLogger): ReplayStore {
  const primary = new RedisReplayStore(redis, "gk:token:");
  const fallback = new PostgresReplayStore(db.consumedToken, (key) => {
    // jti values are namespaced as "<siteId>:<action>:<nonce>" by
    // issueVerificationToken below so the fallback can recover them without
    // a second store.
    const [siteId = "", action = ""] = key.split(":");
    return { siteId, action };
  });

  return new FailoverReplayStore(primary, fallback, (err) => {
    logSecurityEvent({
      type: "REDIS_DEGRADED",
      severity: "HIGH",
      detail: { component: "token_replay_store", message: err instanceof Error ? err.message : String(err) },
    });
  });
}
