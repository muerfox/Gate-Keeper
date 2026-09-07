import { randomId, hashSecret, verifySecretHash } from "@gatekeeper/crypto";
import { SITE_KEY_PREFIX_PUBLIC, SITE_KEY_PREFIX_SECRET, SITE_KEY_PREFIX_DEV } from "@gatekeeper/shared";
import type { PrismaClient } from "../db.js";

const PREFIX_LOOKUP_LENGTH = 16;

export interface GeneratedKey {
  /** Full key value. For public keys this is safe to embed in browser JS
   * and is stored (as `publicValue`) so it can be displayed again later.
   * For secret keys this is shown to the administrator ONCE and only its
   * hash is persisted (docs/THREAT_MODEL.md §4.7). */
  value: string;
  keyPrefix: string;
  keyHash: string;
}

export function generateKey(type: "PUBLIC_SITE_KEY" | "SECRET_SERVER_KEY", environment: "DEVELOPMENT" | "PRODUCTION"): GeneratedKey {
  const isPublic = type === "PUBLIC_SITE_KEY";
  const base = isPublic ? SITE_KEY_PREFIX_PUBLIC : SITE_KEY_PREFIX_SECRET;
  const envTag = environment === "DEVELOPMENT" ? SITE_KEY_PREFIX_DEV : "";
  const value = `${envTag}${base}${randomId(24)}`;
  return {
    value,
    keyPrefix: value.slice(0, PREFIX_LOOKUP_LENGTH),
    keyHash: hashSecret(value),
  };
}

export interface ResolvedApiKey {
  id: string;
  siteId: string;
  type: "PUBLIC_SITE_KEY" | "SECRET_SERVER_KEY";
  environment: "DEVELOPMENT" | "PRODUCTION";
}

/** Resolves and authenticates a public site key presented by the widget.
 * Public keys are looked up by their full value (they're not secret, so a
 * direct equality lookup is fine) and must not be revoked. */
export async function resolvePublicSiteKey(db: PrismaClient, siteKey: string): Promise<ResolvedApiKey | null> {
  const record = await db.apiKey.findFirst({
    where: { type: "PUBLIC_SITE_KEY", publicValue: siteKey, revokedAt: null },
  });
  if (!record) return null;
  return { id: record.id, siteId: record.siteId, type: record.type, environment: record.environment };
}

/** Resolves and authenticates a secret server key presented by a customer
 * backend via `Authorization: Bearer <key>`. Looked up by prefix (fast,
 * indexed), then the full value is checked against the stored hash in
 * constant time — the raw secret is never persisted. */
export async function resolveSecretServerKey(db: PrismaClient, secretKey: string): Promise<ResolvedApiKey | null> {
  const prefix = secretKey.slice(0, PREFIX_LOOKUP_LENGTH);
  const candidates = await db.apiKey.findMany({
    where: { type: "SECRET_SERVER_KEY", keyPrefix: prefix, revokedAt: null },
  });
  for (const candidate of candidates) {
    if (verifySecretHash(secretKey, candidate.keyHash)) {
      return { id: candidate.id, siteId: candidate.siteId, type: candidate.type, environment: candidate.environment };
    }
  }
  return null;
}
