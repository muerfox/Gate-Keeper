import type { FastifyReply, FastifyRequest } from "fastify";
import { hashSecret } from "@gatekeeper/crypto";
import type { AppContext } from "./context.js";

export interface AdminPrincipal {
  id: string;
  role: "OWNER" | "ADMIN" | "VIEWER";
  email: string;
}

const ROLE_RANK: Record<AdminPrincipal["role"], number> = { VIEWER: 0, ADMIN: 1, OWNER: 2 };

declare module "fastify" {
  interface FastifyRequest {
    admin?: AdminPrincipal;
  }
}

/** Resolves the `Authorization: Bearer <session token>` header into an
 * authenticated administrator. The raw token is never stored — only its
 * hash (docs/THREAT_MODEL.md §4.7 applies to session tokens too, not just
 * API keys) — so this looks up by hash and additionally checks expiry and
 * revocation on every call rather than trusting a long-lived claim. */
export async function authenticateAdmin(ctx: AppContext, request: FastifyRequest): Promise<AdminPrincipal | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const tokenHash = hashSecret(token);

  const session = await ctx.db.adminSession.findUnique({ where: { tokenHash }, include: { admin: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.admin.disabledAt) return null;

  return { id: session.admin.id, role: session.admin.role, email: session.admin.email };
}

/** Fastify preHandler factory enforcing both authentication and a minimum
 * RBAC role. Used as: `{ preHandler: requireAdmin(ctx, "ADMIN") }`. */
export function requireAdmin(ctx: AppContext, minRole: AdminPrincipal["role"] = "VIEWER") {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await authenticateAdmin(ctx, request);
    if (!admin) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (ROLE_RANK[admin.role] < ROLE_RANK[minRole]) {
      return reply.code(403).send({ error: "forbidden", requiredRole: minRole });
    }
    request.admin = admin;
  };
}
