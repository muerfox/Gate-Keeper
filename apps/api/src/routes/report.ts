import type { FastifyInstance } from "fastify";
import { ReportRequestSchema } from "@gatekeeper/shared";
import type { AppContext } from "../context.js";
import { resolvePublicSiteKey } from "../keys/site-keys.js";

/** Lets an integrator report a false positive/negative or observed abuse
 * back to Gate Keeper — feedback that a human operator reviews in the
 * dashboard's Security Events view. This endpoint never changes a
 * verification outcome by itself (a report is not a re-verification); it
 * only records the signal. */
export function registerReportRoute(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/v1/report", async (request, reply) => {
    const parsed = ReportRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });
    }

    const resolvedKey = await resolvePublicSiteKey(ctx.db, parsed.data.siteKey);
    if (!resolvedKey) return reply.code(401).send({ error: "invalid_site_key" });

    const rateLimitResult = await ctx.rateLimiter.check({ ip: request.ip, siteId: resolvedKey.siteId, action: "report" });
    if (!rateLimitResult.allowed) return reply.code(429).send({ error: "rate_limited" });

    ctx.logSecurityEvent({
      siteId: resolvedKey.siteId,
      type: "SUSPICIOUS_TRAFFIC",
      severity: "LOW",
      detail: { reason: parsed.data.reason, note: parsed.data.detail, reportedTokenPresent: Boolean(parsed.data.token) },
      requestIp: request.ip,
    });

    return reply.code(202).send({ received: true });
  });
}
