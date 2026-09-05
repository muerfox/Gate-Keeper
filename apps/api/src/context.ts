import type { Redis } from "ioredis";
import { JwsSigner, loadSigningKeyMaterial } from "@gatekeeper/crypto";
import type { ReplayStore, CompositeRateLimiter } from "@gatekeeper/rate-limit";
import type { Logger } from "pino";
import type { Env } from "./env.js";
import type { PrismaClient } from "./db.js";
import { createDbClient } from "./db.js";
import { createAppRedisClient } from "./redis.js";
import { createSecurityEventLogger, type SecurityEventLogger } from "./security-events.js";
import { createTokenReplayStore } from "./token-store.js";
import { createDefaultRateLimiter } from "./rate-limits.js";
import { ChallengeStore } from "./challenge-store.js";
import { FailureTracker } from "./failure-tracker.js";

export interface AppContext {
  env: Env;
  db: PrismaClient;
  redis: Redis;
  signer: JwsSigner;
  challengeStore: ChallengeStore;
  tokenReplayStore: ReplayStore;
  rateLimiter: CompositeRateLimiter;
  logSecurityEvent: SecurityEventLogger;
  failureTracker: FailureTracker;
}

export async function buildContext(env: Env, logger: Logger): Promise<AppContext> {
  const db = createDbClient(env.DATABASE_URL);
  const redis = createAppRedisClient(env.REDIS_URL);
  const keys = await loadSigningKeyMaterial(env.GATEKEEPER_SIGNING_KEY);
  const signer = new JwsSigner(keys);
  const logSecurityEvent = createSecurityEventLogger(db, logger);

  return {
    env,
    db,
    redis,
    signer,
    challengeStore: new ChallengeStore(redis),
    tokenReplayStore: createTokenReplayStore(redis, db, logSecurityEvent),
    rateLimiter: createDefaultRateLimiter(redis),
    logSecurityEvent,
    failureTracker: new FailureTracker(redis),
  };
}
