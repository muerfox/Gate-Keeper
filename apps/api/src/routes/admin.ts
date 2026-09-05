import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as OTPAuth from "otpauth";
import { verifyPassword, randomId, hashSecret, encryptAtRest, decryptAtRest } from "@gatekeeper/crypto";
import { ExponentialBackoff } from "@gatekeeper/rate-limit";
import type { AppContext } from "../context.js";
import { requireAdmin, authenticateAdmin } from "../admin-auth.js";

const LoginSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1).max(256),
    totp: z.string().length(6).optional(),
  })
  .strict();

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Administrator authentication. Every login attempt — successful or not —
 * is subject to exponential backoff keyed by email+IP
 * (docs spec: "login rate limiting"), and failure responses are
 * intentionally generic ("invalid_credentials") regardless of whether the
 * email exists, the password was wrong, or TOTP was wrong, to avoid
 * leaking which case occurred (account enumeration).
 */
export function registerAdminAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const backoff = new ExponentialBackoff(ctx.redis);

  app.post("/api/v1/admin/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const backoffKey = `${parsed.data.email}:${request.ip}`;
    const retryAfter = await backoff.currentRetryAfterSeconds(backoffKey);
    if (retryAfter > 0) {
      return reply.code(429).header("Retry-After", String(retryAfter)).send({ error: "too_many_attempts", retryAfterSeconds: retryAfter });
    }

    const admin = await ctx.db.administrator.findUnique({ where: { email: parsed.data.email } });
    const fail = async (reason: string) => {
      await backoff.recordFailure(backoffKey);
      ctx.logSecurityEvent({ type: "ADMIN_LOGIN_FAILURE", detail: { email: parsed.data.email, reason }, requestIp: request.ip });
      return reply.code(401).send({ error: "invalid_credentials" });
    };

    if (!admin || admin.disabledAt) return fail("no_such_account");

    const passwordOk = await verifyPassword(parsed.data.password, admin.passwordHash);
    if (!passwordOk) return fail("bad_password");

    if (admin.totpEnabled) {
      // Distinct from "invalid_credentials": the password has already been
      // verified at this point, so telling the caller a second factor is
      // needed does not leak anything about email/password guessing (that
      // path is still covered by the generic failure above + backoff).
      if (!parsed.data.totp || !admin.totpSecretEnc) {
        return reply.code(401).send({ error: "totp_required" });
      }
      const secret = decryptAtRest(admin.totpSecretEnc, ctx.env.GATEKEEPER_ENCRYPTION_KEY);
      const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });
      const delta = totp.validate({ token: parsed.data.totp, window: 1 });
      if (delta === null) return fail("bad_totp");
    }

    await backoff.reset(backoffKey);

    const sessionToken = randomId(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await ctx.db.adminSession.create({
      data: { adminId: admin.id, tokenHash: hashSecret(sessionToken), expiresAt, ipAddress: request.ip, userAgent: request.headers["user-agent"] },
    });
    await ctx.db.administrator.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

    ctx.logSecurityEvent({ type: "ADMIN_LOGIN_SUCCESS", detail: { adminId: admin.id }, requestIp: request.ip });

    return reply.code(200).send({ sessionToken, expiresAt: expiresAt.getTime(), role: admin.role });
  });

  app.post("/api/v1/admin/logout", { preHandler: requireAdmin(ctx, "VIEWER") }, async (request, reply) => {
    const header = request.headers.authorization!;
    const token = header.slice(7);
    await ctx.db.adminSession.updateMany({ where: { tokenHash: hashSecret(token) }, data: { revokedAt: new Date() } });
    return reply.code(204).send();
  });

  // --- TOTP enrollment -----------------------------------------------
  app.post("/api/v1/admin/totp/setup", { preHandler: requireAdmin(ctx, "VIEWER") }, async (request, reply) => {
    const admin = request.admin!;
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ issuer: "GateKeeper", label: admin.email, secret, digits: 6, period: 30 });

    // Stored encrypted-at-rest immediately but NOT marked enabled until the
    // administrator proves possession via /totp/enable — otherwise a setup
    // request that's never completed would silently require TOTP with a
    // secret the admin never actually saw/confirmed.
    await ctx.db.administrator.update({
      where: { id: admin.id },
      data: { totpSecretEnc: encryptAtRest(secret.base32, ctx.env.GATEKEEPER_ENCRYPTION_KEY), totpEnabled: false },
    });

    return reply.code(200).send({ secret: secret.base32, otpauthUrl: totp.toString() });
  });

  const EnableSchema = z.object({ totp: z.string().length(6) }).strict();
  app.post("/api/v1/admin/totp/enable", { preHandler: requireAdmin(ctx, "VIEWER") }, async (request, reply) => {
    const parsed = EnableSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const admin = await ctx.db.administrator.findUniqueOrThrow({ where: { id: request.admin!.id } });
    if (!admin.totpSecretEnc) return reply.code(400).send({ error: "totp_not_initialized" });

    const secret = decryptAtRest(admin.totpSecretEnc, ctx.env.GATEKEEPER_ENCRYPTION_KEY);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });
    if (totp.validate({ token: parsed.data.totp, window: 1 }) === null) {
      return reply.code(400).send({ error: "invalid_totp_code" });
    }

    await ctx.db.administrator.update({ where: { id: admin.id }, data: { totpEnabled: true } });
    return reply.code(200).send({ enabled: true });
  });
}

export { authenticateAdmin };
