/**
 * Minimal in-process TTL cache for low-sensitivity, read-mostly data on the
 * hot path (site config, domain lists) — found to be a real throughput
 * bottleneck under load (tests/performance/load-test.mjs): every
 * /api/v1/challenge and /api/v1/verify call was doing a synchronous
 * Prisma round trip for `siteConfig.findUnique` and `domain.count` before
 * this cache existed, which serializes under Prisma's connection pool at
 * concurrency.
 *
 * Deliberately NOT used for API key resolution: a revoked key must stop
 * working immediately, so that lookup stays uncached (see
 * apps/api/src/keys/site-keys.ts). Config/domain staleness of up to
 * `ttlMs` is an accepted trade-off for those specific low-sensitivity
 * reads — an admin's config or domain change can take up to that long to
 * take effect. This is a single-process cache; a multi-instance
 * deployment has independent caches per instance, which is fine for this
 * use (the staleness bound still holds per-instance) but is not a
 * substitute for the Redis-backed state that DOES need cross-instance
 * consistency (rate limits, replay protection).
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.value;

    const value = await load();
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }
}
