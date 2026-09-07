import type { PrismaClient } from "./db.js";
import type { Logger } from "pino";

export interface SecurityEventInput {
  siteId?: string;
  type:
    | "RATE_LIMIT_EXCEEDED"
    | "REPLAY_DETECTED"
    | "INVALID_TOKEN"
    | "CROSS_SITE_TOKEN"
    | "CROSS_ACTION_TOKEN"
    | "DOMAIN_MISMATCH"
    | "REDIS_DEGRADED"
    | "DB_DEGRADED"
    | "ADMIN_LOGIN_FAILURE"
    | "ADMIN_LOGIN_SUCCESS"
    | "API_KEY_CREATED"
    | "API_KEY_ROTATED"
    | "API_KEY_REVOKED"
    | "SUSPICIOUS_TRAFFIC";
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  detail: Record<string, unknown>;
  requestIp?: string;
}

/**
 * Best-effort, fire-and-forget security event logging. Deliberately never
 * throws or blocks the request path on a write failure — a degraded
 * database must not turn "log this suspicious event" into "fail the
 * request that triggered it" (that would let an attacker cause outages by
 * generating events during a DB blip). Failures are logged locally instead.
 */
export function createSecurityEventLogger(db: PrismaClient, logger: Logger) {
  return function logSecurityEvent(input: SecurityEventInput): void {
    db.securityEvent
      .create({
        data: {
          siteId: input.siteId,
          type: input.type,
          severity: input.severity ?? "MEDIUM",
          detail: input.detail as never,
          requestIp: input.requestIp,
        },
      })
      .catch((err: unknown) => {
        logger.error({ err, event: input }, "failed to persist security event");
      });
  };
}

export type SecurityEventLogger = ReturnType<typeof createSecurityEventLogger>;
