import type { FastifyInstance } from "fastify";
import { CreateApiKeyRequestSchema } from "@gatekeeper/shared";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAdmin } from "../admin-auth.js";
import { generateKey } from "../keys/site-keys.js";

/**
 * Key management. Secret server keys are returned in the response body
 * exactly once, at creation time, and are never retrievable again — only
 * their prefix and metadata persist for display (docs/THREAT_MODEL.md
 * §4.7). Public site keys are safe to return again later (GET /site
 * already includes `publicValue`).
 */
export function registerKeyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/v1/keys", { preHandler: requireAdmin(ctx, "ADMIN") }, async (request, reply) => {
    const parsed = CreateApiKeyRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });

    const site = await ctx.db.site.findUnique({ where: { id: parsed.data.siteId } });
    if (!site) return reply.code(404).send({ error: "site_not_found" });

    const generated = generateKey(parsed.data.type, parsed.data.environment);
    const record = await ctx.db.apiKey.create({
      data: {
        siteId: parsed.data.siteId,
        type: parsed.data.type,
        environment: parsed.data.environment,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        publicValue: parsed.data.type === "PUBLIC_SITE_KEY" ? generated.value : null,
      },
    });

    await ctx.db.auditLog.create({
      data: { adminId: request.admin!.id, action: "api_key.create", targetType: "api_key", targetId: record.id, ipAddress: request.ip },
    });
    ctx.logSecurityEvent({ siteId: parsed.data.siteId, type: "API_KEY_CREATED", detail: { keyId: record.id, type: parsed.data.type } });

    return reply.code(201).send({ id: record.id, type: record.type, environment: record.environment, value: generated.value });
  });

  app.delete("/api/v1/keys/:id", { preHandler: requireAdmin(ctx, "ADMIN") }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const key = await ctx.db.apiKey.findUnique({ where: { id: params.data.id } });
    if (!key) return reply.code(404).send({ error: "not_found" });

    await ctx.db.apiKey.update({ where: { id: params.data.id }, data: { revokedAt: new Date() } });
    await ctx.db.auditLog.create({
      data: { adminId: request.admin!.id, action: "api_key.revoke", targetType: "api_key", targetId: key.id, ipAddress: request.ip },
    });
    ctx.logSecurityEvent({ siteId: key.siteId, type: "API_KEY_REVOKED", detail: { keyId: key.id } });

    return reply.code(204).send();
  });
}
