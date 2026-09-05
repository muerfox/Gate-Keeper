// @ts-expect-error -- ioredis-mock has no types package
import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { JwsSigner, loadSigningKeyMaterial, generateHmacKeyMaterial, generateEncryptionKey } from "@gatekeeper/crypto";
import { createDefaultRateLimiter } from "../../apps/api/src/rate-limits.js";
import { ChallengeStore } from "../../apps/api/src/challenge-store.js";
import { FailureTracker } from "../../apps/api/src/failure-tracker.js";
import { createSecurityEventLogger } from "../../apps/api/src/security-events.js";
import { createTokenReplayStore } from "../../apps/api/src/token-store.js";
import { createSiteMetaCache } from "../../apps/api/src/site-meta.js";
import { createDbClient, type PrismaClient } from "../../apps/api/src/db.js";
import { buildApp } from "../../apps/api/src/app.js";
import type { AppContext } from "../../apps/api/src/context.js";
import type { Env } from "../../apps/api/src/env.js";
import { startTestPostgres, type TestPostgres } from "./postgres.js";
import pino from "pino";

export interface TestApp {
  app: Awaited<ReturnType<typeof buildApp>>;
  ctx: AppContext;
  db: PrismaClient;
  redis: Redis;
  stop(): Promise<void>;
}

/** Builds a full Gate Keeper API instance against a real ephemeral Postgres
 * (see tests/helpers/postgres.ts) and an in-memory Redis mock, with a fresh
 * random signing key/encryption key per test run. Used by
 * tests/security/*.test.ts and tests/integration/*.test.ts to exercise the
 * actual HTTP routes rather than unit-testing packages in isolation. */
export async function buildTestApp(): Promise<TestApp> {
  const pg: TestPostgres = await startTestPostgres();

  const env: Env = {
    NODE_ENV: "test",
    PORT: 0,
    DATABASE_URL: pg.databaseUrl,
    REDIS_URL: "redis://unused-in-tests",
    GATEKEEPER_SIGNING_KEY: generateHmacKeyMaterial(),
    GATEKEEPER_ENCRYPTION_KEY: generateEncryptionKey(),
    GATEKEEPER_REDIS_FAILURE_POLICY: "fail_closed",
    GATEKEEPER_DB_FAILURE_POLICY: "fail_closed",
    GATEKEEPER_CORS_ORIGINS: "",
  };

  const db = createDbClient(env.DATABASE_URL);
  const redis = new RedisMock() as unknown as Redis;
  const keys = await loadSigningKeyMaterial(env.GATEKEEPER_SIGNING_KEY);
  const signer = new JwsSigner(keys);
  const logger = pino({ level: "silent" });
  const logSecurityEvent = createSecurityEventLogger(db, logger);

  const ctx: AppContext = {
    env,
    db,
    redis,
    signer,
    challengeStore: new ChallengeStore(redis),
    tokenReplayStore: createTokenReplayStore(redis, db, logSecurityEvent),
    rateLimiter: createDefaultRateLimiter(redis),
    logSecurityEvent,
    failureTracker: new FailureTracker(redis),
    siteMetaCache: createSiteMetaCache(),
  };

  const app = await buildApp(ctx);
  await app.ready();

  return {
    app,
    ctx,
    db,
    redis,
    async stop() {
      await app.close();
      await db.$disconnect();
      await pg.stop();
    },
  };
}
