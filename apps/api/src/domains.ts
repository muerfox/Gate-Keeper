import type { PrismaClient } from "./db.js";

/** Extracts a hostname from an Origin or Referer header. Returns null for
 * anything that doesn't parse as a URL (never throws on attacker input). */
export function extractHostname(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  try {
    return new URL(headerValue).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Enforces the "a token issued for one configured site must not
 * automatically work on another site" requirement at the domain level: a
 * public site key may only be used from an Origin/Referer that the site
 * administrator has explicitly registered (docs/THREAT_MODEL.md §4.3).
 * Exact hostname match only — no wildcard/subdomain inference, since that
 * would silently broaden the trust boundary the administrator configured.
 */
export async function isDomainAllowed(db: PrismaClient, siteId: string, hostname: string | null): Promise<boolean> {
  if (!hostname) return false;
  const match = await db.domain.findFirst({ where: { siteId, hostname } });
  return match !== null;
}
