import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAdmin } from "../admin-auth.js";

const QuerySchema = z.object({
  siteId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** Read-only audit view of issued challenges (the DB row written
 * alongside the Redis-held ChallengeRecord — see routes/challenge.ts).
 * `state` mostly reads ISSUED here since consumption updates the Redis
 * copy, not this row; it exists for volume/difficulty-distribution
 * analytics, not as the source of truth for whether a challenge is still
 * usable. */
export function registerChallengesRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/v1/challenges", { preHandler: requireAdmin(ctx, "VIEWER") }, async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const challenges = await ctx.db.challenge.findMany({
      where: parsed.data.siteId ? { siteId: parsed.data.siteId } : undefined,
      orderBy: { issuedAt: "desc" },
      take: parsed.data.limit,
      ...(parsed.data.cursor ? { skip: 1, cursor: { id: parsed.data.cursor } } : {}),
    });

    return reply.code(200).send({
      challenges,
      nextCursor: challenges.length === parsed.data.limit ? challenges[challenges.length - 1]?.id : null,
    });
  });
}
