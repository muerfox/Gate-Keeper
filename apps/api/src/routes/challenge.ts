import type { FastifyInstance } from "fastify";
import { ChallengeRequestSchema } from "@gatekeeper/shared";
import { issueChallenge } from "@gatekeeper/challenges";
import { selectChallengeType } from "@gatekeeper/challenges";
import { DEFAULT_CHALLENGE_TTL_SECONDS } from "@gatekeeper/shared";
import type { AppContext } from "../context.js";
import { resolvePublicSiteKey } from "../keys/site-keys.js";
import { extractHostname, isDomainAllowed } from "../domains.js";

export function registerChallengeRoute(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/v1/challenge", async (request, reply) => {
    const parsed = ChallengeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });
    }
    const { siteKey, action, accessible } = parsed.data;
    const ip = request.ip;

    const resolvedKey = await resolvePublicSiteKey(ctx.db, siteKey);
    if (!resolvedKey) {
      return reply.code(401).send({ error: "invalid_site_key" });
    }

    const rateLimitResult = await ctx.rateLimiter.check({
      ip,
      siteId: resolvedKey.siteId,
      action,
      sessionId: parsed.data.sessionHint,
      apiKeyId: resolvedKey.id,
    });
    if (!rateLimitResult.allowed) {
      ctx.logSecurityEvent({
        siteId: resolvedKey.siteId,
        type: "RATE_LIMIT_EXCEEDED",
        detail: { endpoint: "challenge", rule: rateLimitResult.violatedRule },
        requestIp: ip,
      });
      return reply.code(429).send({ error: "rate_limited", rule: rateLimitResult.violatedRule });
    }

    const domainCount = await ctx.db.domain.count({ where: { siteId: resolvedKey.siteId } });
    if (domainCount > 0) {
      const hostname = extractHostname(request.headers.origin) ?? extractHostname(request.headers.referer);
      const allowed = await isDomainAllowed(ctx.db, resolvedKey.siteId, hostname);
      if (!allowed) {
        ctx.logSecurityEvent({
          siteId: resolvedKey.siteId,
          type: "DOMAIN_MISMATCH",
          detail: { hostname, action },
          requestIp: ip,
        });
        return reply.code(403).send({ error: "domain_not_allowed" });
      }
    }

    const config = await ctx.db.siteConfig.findUnique({ where: { siteId: resolvedKey.siteId } });
    const allowComputational = config?.computationalChallengesEnabled ?? true;

    // Lightweight issuance-time escalation: use the sliding-window counts
    // already computed by the rate limiter as a coarse signal, since no
    // interaction events exist yet at issuance time — the full behavioral
    // risk assessment happens at /verify (Layer 4).
    const ipOutcome = rateLimitResult.outcomes.find((o) => o.rule === "ip");
    const recentCount = ipOutcome && "count" in ipOutcome.detail ? ipOutcome.detail.count : 0;
    const difficulty = recentCount > 30 ? 4 : recentCount > 12 ? 2 : 1;

    const type = selectChallengeType({ requireAccessible: accessible, allowComputational });

    const { record, publicChallenge } = await issueChallenge(ctx.signer, {
      siteId: resolvedKey.siteId,
      action,
      type,
      difficulty,
      ttlSeconds: DEFAULT_CHALLENGE_TTL_SECONDS,
    });

    await ctx.challengeStore.put(record);

    ctx.db.challenge
      .create({
        data: {
          id: record.id,
          siteId: record.siteId,
          action: record.action,
          type: challengeTypeToEnum(record.type) as never,
          difficulty: record.difficulty,
          nonce: record.nonce,
          expiresAt: new Date(record.expiresAt),
        },
      })
      .catch((err: unknown) => request.log.error({ err }, "failed to persist challenge audit row"));

    return reply.code(200).send(publicChallenge);
  });
}

function challengeTypeToEnum(type: string): string {
  return type.toUpperCase();
}
