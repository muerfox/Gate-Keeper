import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  VerifyRequestSchema,
  ServerVerifyRequestSchema,
  DEFAULT_CHALLENGE_TTL_SECONDS,
  DEFAULT_TOKEN_TTL_SECONDS,
} from "@gatekeeper/shared";
import { verifyEnvelope, checkAnswer, issueChallenge, selectChallengeType, EnvelopeMismatchError } from "@gatekeeper/challenges";
import { InvalidSignatureError, TokenExpiredError } from "@gatekeeper/crypto";
import { assessRisk, difficultyForLevel } from "@gatekeeper/risk-engine";
import type { RiskLevel } from "@gatekeeper/shared";
import type { AppContext } from "../context.js";
import { resolvePublicSiteKey, resolveSecretServerKey } from "../keys/site-keys.js";
import { extractHostname, isDomainAllowed } from "../domains.js";
import { issueVerificationToken, verifyAndConsumeToken } from "../token.js";
import { getSiteMeta } from "../site-meta.js";

/** Post-answer gating: distinct from risk-engine's general
 * `decideAction` (which picks whether/how hard to challenge BEFORE any
 * challenge exists). Here the user has already solved the issued
 * challenge correctly — MEDIUM risk is treated as satisfied by that
 * challenge rather than triggering another one (which would loop forever,
 * since post-hoc analysis of a freshly-solved challenge is very often
 * still MEDIUM). Only HIGH/CRITICAL findings discovered by the behavioral
 * analysis override a correct answer. */
function postAnswerAction(level: RiskLevel): "allow" | "hard_challenge" | "block" {
  if (level === "CRITICAL") return "block";
  if (level === "HIGH") return "hard_challenge";
  return "allow";
}

export function registerVerifyRoute(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/v1/verify", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;

    if (body && typeof body === "object" && "challengeId" in body) {
      return handleClientVerify(app, ctx, request, reply);
    }
    if (body && typeof body === "object" && "token" in body) {
      return handleServerVerify(ctx, request, reply);
    }
    return reply.code(400).send({ error: "invalid_request", details: "body must include either challengeId or token" });
  });
}

async function handleClientVerify(app: FastifyInstance, ctx: AppContext, request: FastifyRequest, reply: FastifyReply) {
  const parsed = VerifyRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });
  }
  const { siteKey, action, challengeId, signedEnvelope, answer, events } = parsed.data;
  const ip = request.ip;

  const resolvedKey = await resolvePublicSiteKey(ctx.db, siteKey);
  if (!resolvedKey) return reply.code(401).send({ error: "invalid_site_key" });

  const rateLimitResult = await ctx.rateLimiter.check({ ip, siteId: resolvedKey.siteId, action, apiKeyId: resolvedKey.id });
  if (!rateLimitResult.allowed) {
    ctx.logSecurityEvent({
      siteId: resolvedKey.siteId,
      type: "RATE_LIMIT_EXCEEDED",
      detail: { endpoint: "verify", rule: rateLimitResult.violatedRule },
      requestIp: ip,
    });
    return reply.code(429).send({ error: "rate_limited", rule: rateLimitResult.violatedRule });
  }

  const siteMeta = await getSiteMeta(ctx.db, ctx.siteMetaCache, resolvedKey.siteId);
  if (siteMeta.domainHostnames.length > 0) {
    const hostname = extractHostname(request.headers.origin) ?? extractHostname(request.headers.referer);
    if (!isDomainAllowed(siteMeta.domainHostnames, hostname)) {
      ctx.logSecurityEvent({ siteId: resolvedKey.siteId, type: "DOMAIN_MISMATCH", detail: { hostname, action }, requestIp: ip });
      return reply.code(403).send({ error: "domain_not_allowed" });
    }
  }

  const record = await ctx.challengeStore.takeOnce(challengeId);
  if (!record) {
    ctx.logSecurityEvent({
      siteId: resolvedKey.siteId,
      type: "REPLAY_DETECTED",
      detail: { challengeId, reason: "not_found_or_already_consumed" },
      requestIp: ip,
    });
    await recordAttempt(ctx, { siteId: resolvedKey.siteId, action, challengeId, outcome: "ALREADY_CONSUMED", riskLevel: "CRITICAL", ip });
    return reply.code(200).send({ success: false, outcome: "ALREADY_CONSUMED", riskLevel: "CRITICAL" });
  }

  try {
    const envelope = await verifyEnvelope(ctx.signer, signedEnvelope, { siteId: resolvedKey.siteId, action, challengeId });
    if (envelope.nonce !== record.nonce) throw new EnvelopeMismatchError("nonce");
  } catch (err) {
    const outcome =
      err instanceof TokenExpiredError
        ? "EXPIRED"
        : err instanceof EnvelopeMismatchError
          ? mismatchOutcome(err)
          : "INVALID_SIGNATURE";
    ctx.logSecurityEvent({
      siteId: resolvedKey.siteId,
      type: outcome === "INVALID_SIGNATURE" ? "INVALID_TOKEN" : outcome === "SITE_MISMATCH" ? "CROSS_SITE_TOKEN" : "CROSS_ACTION_TOKEN",
      detail: { challengeId, action },
      requestIp: ip,
    });
    await recordAttempt(ctx, { siteId: resolvedKey.siteId, action, challengeId, outcome, riskLevel: "HIGH", ip });
    return reply.code(200).send({ success: false, outcome, riskLevel: "HIGH" });
  }

  const answerCorrect = checkAnswer(record, answer);
  const recentFailureCount = await ctx.failureTracker.peek(resolvedKey.siteId, ip);
  const siteActionOutcome = rateLimitResult.outcomes.find((o) => o.rule === "site_action");
  const recentRequestVelocity = siteActionOutcome && "count" in siteActionOutcome.detail ? siteActionOutcome.detail.count : 0;

  const assessment = assessRisk({
    events,
    serverObservedSolveMs: Date.now() - record.issuedAt,
    minPlausibleSolveMs: record.minPlausibleSolveMs,
    recentRequestVelocity,
    recentFailureCount,
    replayDetected: false,
  });

  app.log.debug({ assessment }, "risk assessment");
  recordRiskEvent(ctx, resolvedKey.siteId, action, assessment);

  if (!answerCorrect) {
    await ctx.failureTracker.recordFailure(resolvedKey.siteId, ip);
    await recordAttempt(ctx, { siteId: resolvedKey.siteId, action, challengeId, outcome: "FAILED_ANSWER", riskLevel: assessment.level, ip });
    return reply.code(200).send({ success: false, outcome: "FAILED_ANSWER", riskLevel: assessment.level });
  }

  const decision = postAnswerAction(assessment.level);

  if (decision === "block") {
    ctx.logSecurityEvent({ siteId: resolvedKey.siteId, type: "SUSPICIOUS_TRAFFIC", severity: "CRITICAL", detail: { action, reasons: assessment.reasons }, requestIp: ip });
    await recordAttempt(ctx, { siteId: resolvedKey.siteId, action, challengeId, outcome: "RISK_BLOCKED", riskLevel: assessment.level, ip });
    return reply.code(200).send({ success: false, outcome: "RISK_BLOCKED", riskLevel: assessment.level });
  }

  if (decision === "hard_challenge") {
    const type = selectChallengeType({ allowComputational: true });
    const { record: nextRecord, publicChallenge } = await issueChallenge(ctx.signer, {
      siteId: resolvedKey.siteId,
      action,
      type,
      difficulty: difficultyForLevel(assessment.level),
      ttlSeconds: DEFAULT_CHALLENGE_TTL_SECONDS,
    });
    await ctx.challengeStore.put(nextRecord);
    await recordAttempt(ctx, { siteId: resolvedKey.siteId, action, challengeId, outcome: "CHALLENGE_REQUIRED", riskLevel: assessment.level, ip });
    return reply.code(200).send({ success: false, outcome: "CHALLENGE_REQUIRED", riskLevel: assessment.level, nextChallenge: publicChallenge });
  }

  const token = await issueVerificationToken(ctx.signer, {
    siteId: resolvedKey.siteId,
    action,
    challengeId,
    riskLevel: assessment.level,
    environment: resolvedKey.environment,
    ttlSeconds: DEFAULT_TOKEN_TTL_SECONDS,
  });

  await recordAttempt(ctx, { siteId: resolvedKey.siteId, action, challengeId, outcome: "SUCCESS", riskLevel: assessment.level, ip });
  return reply.code(200).send({ success: true, outcome: "SUCCESS", riskLevel: assessment.level, token });
}

async function handleServerVerify(ctx: AppContext, request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const secretKey = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!secretKey) return reply.code(401).send({ error: "missing_secret_key" });

  const resolvedKey = await resolveSecretServerKey(ctx.db, secretKey);
  if (!resolvedKey || resolvedKey.type !== "SECRET_SERVER_KEY") {
    return reply.code(401).send({ error: "invalid_secret_key" });
  }

  const parsed = ServerVerifyRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_request", details: parsed.error.issues });
  }

  const rateLimitResult = await ctx.rateLimiter.check({ ip: request.ip, siteId: resolvedKey.siteId, action: parsed.data.action, apiKeyId: resolvedKey.id });
  if (!rateLimitResult.allowed) {
    ctx.logSecurityEvent({ siteId: resolvedKey.siteId, type: "RATE_LIMIT_EXCEEDED", detail: { endpoint: "verify_server" }, requestIp: request.ip });
    return reply.code(429).send({ error: "rate_limited" });
  }

  const result = await verifyAndConsumeToken(ctx.signer, ctx.tokenReplayStore, parsed.data.token, parsed.data.action, resolvedKey.siteId);

  if (!result.success && result.outcome === "ALREADY_CONSUMED") {
    ctx.logSecurityEvent({ siteId: resolvedKey.siteId, type: "REPLAY_DETECTED", detail: { action: parsed.data.action }, requestIp: request.ip });
  }
  if (!result.success && (result.outcome === "SITE_MISMATCH" || result.outcome === "ACTION_MISMATCH")) {
    ctx.logSecurityEvent({
      siteId: resolvedKey.siteId,
      type: result.outcome === "SITE_MISMATCH" ? "CROSS_SITE_TOKEN" : "CROSS_ACTION_TOKEN",
      detail: { action: parsed.data.action },
      requestIp: request.ip,
    });
  }

  return reply.code(200).send({ success: result.success, outcome: result.outcome, riskLevel: result.riskLevel ?? "LOW" });
}

function mismatchOutcome(err: EnvelopeMismatchError): "SITE_MISMATCH" | "ACTION_MISMATCH" | "INVALID_SIGNATURE" {
  if (err.message.endsWith("siteId")) return "SITE_MISMATCH";
  if (err.message.endsWith("action")) return "ACTION_MISMATCH";
  return "INVALID_SIGNATURE";
}

function recordRiskEvent(ctx: AppContext, siteId: string, action: string, assessment: { level: RiskLevel; score: number; reasons: string[] }): void {
  ctx.db.riskEvent
    .create({ data: { siteId, action, riskLevel: assessment.level, score: assessment.score, signals: { reasons: assessment.reasons } } })
    .catch(() => undefined);
}

async function recordAttempt(
  ctx: AppContext,
  input: { siteId: string; action: string; challengeId?: string; outcome: string; riskLevel: RiskLevel; ip: string },
): Promise<void> {
  ctx.db.verificationAttempt
    .create({
      data: {
        siteId: input.siteId,
        action: input.action,
        challengeId: input.challengeId,
        outcome: input.outcome as never,
        riskLevel: input.riskLevel,
        requestIp: input.ip,
      },
    })
    .catch(() => undefined);
}
