import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAdmin } from "../admin-auth.js";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** Audit log of privileged admin-plane actions (site/key create, key
 * revoke, etc. — written by the routes that perform those actions).
 * VIEWER-readable since audit visibility itself is a security control:
 * hiding the log from viewers would make them unable to notice
 * unauthorized changes. */
export function registerAuditLogsRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/v1/audit-logs", { preHandler: requireAdmin(ctx, "VIEWER") }, async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const logs = await ctx.db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit,
      ...(parsed.data.cursor ? { skip: 1, cursor: { id: parsed.data.cursor } } : {}),
      include: { admin: { select: { email: true } } },
    });

    return reply.code(200).send({
      logs,
      nextCursor: logs.length === parsed.data.limit ? logs[logs.length - 1]?.id : null,
    });
  });
}
