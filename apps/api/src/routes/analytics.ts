import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAdmin } from "../admin-auth.js";

const QuerySchema = z.object({
  siteId: z.string().min(1),
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(24),
});

/** Dashboard analytics (docs spec metrics list). Aggregation is done with
 * Prisma's groupBy/count rather than pulling raw rows into the app, since
 * this endpoint is explicitly meant to run over potentially high-volume
 * verification_attempts data (docs/ARCHITECTURE.md §Performance notes). */
export function registerAnalyticsRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/v1/analytics", { preHandler: requireAdmin(ctx, "VIEWER") }, async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const since = new Date(Date.now() - parsed.data.windowHours * 60 * 60 * 1000);
    const where = { siteId: parsed.data.siteId, createdAt: { gte: since } };

    const [totalRequests, byOutcome, byRisk, rateLimitEvents, avgLatency] = await Promise.all([
      ctx.db.verificationAttempt.count({ where }),
      ctx.db.verificationAttempt.groupBy({ by: ["outcome"], where, _count: true }),
      ctx.db.verificationAttempt.groupBy({ by: ["riskLevel"], where, _count: true }),
      ctx.db.securityEvent.count({ where: { siteId: parsed.data.siteId, type: "RATE_LIMIT_EXCEEDED", createdAt: { gte: since } } }),
      ctx.db.verificationAttempt.aggregate({ where, _avg: { latencyMs: true } }),
    ]);

    const successCount = byOutcome.find((o) => o.outcome === "SUCCESS")?._count ?? 0;
    const failedCount = totalRequests - successCount;

    return reply.code(200).send({
      windowHours: parsed.data.windowHours,
      totalRequests,
      successfulVerifications: successCount,
      failedVerifications: failedCount,
      outcomeBreakdown: byOutcome.map((o) => ({ outcome: o.outcome, count: o._count })),
      riskLevelDistribution: byRisk.map((r) => ({ riskLevel: r.riskLevel, count: r._count })),
      rateLimitEvents,
      averageVerificationLatencyMs: avgLatency._avg.latencyMs,
    });
  });
}
