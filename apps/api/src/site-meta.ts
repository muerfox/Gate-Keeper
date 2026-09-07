import type { PrismaClient } from "./db.js";
import { TtlCache } from "./ttl-cache.js";

export interface SiteMeta {
  domainHostnames: string[];
  computationalChallengesEnabled: boolean;
}

const SITE_META_TTL_MS = 5000;

/** Caches the two lookups that were previously done synchronously on every
 * single /api/v1/challenge and /api/v1/verify call (domain allow-list,
 * site config) — see ttl-cache.ts for why. 5s staleness is the accepted
 * trade-off; call `invalidate()` from the site/config update routes for
 * tighter propagation when it matters operationally. */
export function createSiteMetaCache(): TtlCache<SiteMeta> {
  return new TtlCache<SiteMeta>(SITE_META_TTL_MS);
}

export async function getSiteMeta(db: PrismaClient, cache: TtlCache<SiteMeta>, siteId: string): Promise<SiteMeta> {
  return cache.getOrLoad(siteId, async () => {
    const [domains, config] = await Promise.all([
      db.domain.findMany({ where: { siteId }, select: { hostname: true } }),
      db.siteConfig.findUnique({ where: { siteId } }),
    ]);
    return {
      domainHostnames: domains.map((d) => d.hostname),
      computationalChallengesEnabled: config?.computationalChallengesEnabled ?? true,
    };
  });
}
