import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAdmin } from "../admin-auth.js";

const QuerySchema = z.object({
  siteId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export function registerVerificationAttemptsRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/v1/verification-attempts", { preHandler: requireAdmin(ctx, "VIEWER") }, async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const attempts = await ctx.db.verificationAttempt.findMany({
      where: parsed.data.siteId ? { siteId: parsed.data.siteId } : undefined,
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit,
      ...(parsed.data.cursor ? { skip: 1, cursor: { id: parsed.data.cursor } } : {}),
    });

    return reply.code(200).send({
      attempts,
      nextCursor: attempts.length === parsed.data.limit ? attempts[attempts.length - 1]?.id : null,
    });
  });
}
