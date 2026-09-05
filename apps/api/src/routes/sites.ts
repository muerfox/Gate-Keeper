import type { FastifyInstance } from "fastify";
import { CreateSiteRequestSchema } from "@gatekeeper/shared";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAdmin } from "../admin-auth.js";

export function registerSiteRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/v1/sites", { preHandler: requireAdmin(ctx, "VIEWER") }, async (_request, reply) => {
    const sites = await ctx.db.site.findMany({
      orderBy: { createdAt: "desc" },
      include: { domains: true, _count: { select: { apiKeys: true } } },
    });
    return reply.code(200).send({ sites });
  });

  app.get("/api/v1/site", { preHandler: requireAdmin(ctx, "VIEWER") }, async (request, reply) => {
    const query = z.object({ siteId: z.string().min(1) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_request" });

    const site = await ctx.db.site.findUnique({
      where: { id: query.data.siteId },
      include: {
        domains: true,
        config: true,
        apiKeys: { select: { id: true, type: true, environment: true, keyPrefix: true, publicValue: true, createdAt: true, lastUsedAt: true, revokedAt: true } },
      },
    });
    if (!site) return reply.code(404).send({ error: "not_found" });
    return reply.code(200).send(site);
  });

  app.post("/api/v1/sites", { preHandler: requireAdmin(ctx, "ADMIN") }, async (request, reply) => {
    const parsed = CreateSiteRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });

    const site = await ctx.db.site.create({
      data: {
        name: parsed.data.name,
        environment: parsed.data.environment,
        domains: { create: parsed.data.domains.map((hostname) => ({ hostname })) },
        config: { create: {} },
      },
      include: { domains: true, config: true },
    });

    await ctx.db.auditLog.create({
      data: { adminId: request.admin!.id, action: "site.create", targetType: "site", targetId: site.id, ipAddress: request.ip },
    });

    return reply.code(201).send(site);
  });

  const UpdateConfigSchema = z
    .object({
      lowRiskAutoAllow: z.boolean().optional(),
      criticalAction: z.enum(["block", "throttle"]).optional(),
      redisFailurePolicy: z.enum(["fail_open", "fail_closed"]).optional(),
      dbFailurePolicy: z.enum(["fail_open", "fail_closed"]).optional(),
      ipProcessingEnabled: z.boolean().optional(),
      analyticsEnabled: z.boolean().optional(),
      computationalChallengesEnabled: z.boolean().optional(),
    })
    .strict();

  app.patch("/api/v1/site/:id/config", { preHandler: requireAdmin(ctx, "ADMIN") }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const parsed = UpdateConfigSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const config = await ctx.db.siteConfig.update({ where: { siteId: params.data.id }, data: parsed.data }).catch(() => null);
    if (!config) return reply.code(404).send({ error: "not_found" });

    await ctx.db.auditLog.create({
      data: { adminId: request.admin!.id, action: "site.config.update", targetType: "site", targetId: params.data.id, detail: parsed.data, ipAddress: request.ip },
    });

    return reply.code(200).send(config);
  });
}
