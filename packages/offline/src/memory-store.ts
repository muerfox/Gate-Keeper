import type { ChallengeRecord } from "@gatekeeper/challenges";

/**
 * In-process, in-memory replacement for the API's Redis-backed
 * ChallengeStore/ReplayStore (apps/api/src/challenge-store.ts,
 * token-store.ts). This is what makes offline mode "offline" — no Redis,
 * no Postgres, no network call.
 *
 * Trust-model consequence (see docs/OFFLINE_MODE.md): state lives only in
 * this process's memory. It is NOT shared across multiple instances or
 * worker processes, and it is lost on restart. Running more than one
 * offline verifier instance behind a load balancer means each instance has
 * its OWN one-time-use bookkeeping — a token/challenge could be consumed
 * once per instance, not once globally. Single-process deployments are the
 * supported shape for this package; anything else needs the shared
 * Redis-backed online mode.
 */
export class MemoryChallengeStore {
  private readonly records = new Map<string, ChallengeRecord>();

  put(record: ChallengeRecord): void {
    this.records.set(record.id, record);
    setTimeout(() => this.records.delete(record.id), Math.max(record.expiresAt - Date.now(), 0)).unref?.();
  }

  /** Same GET-then-DELETE single-use semantics as the Redis version,
   * except atomicity here comes from JavaScript's single-threaded event
   * loop rather than a Redis command — safe under concurrent async calls
   * within one process, not across processes (see class doc above). */
  takeOnce(challengeId: string): ChallengeRecord | null {
    const record = this.records.get(challengeId);
    if (!record) return null;
    this.records.delete(challengeId);
    if (record.expiresAt < Date.now()) return null;
    return record;
  }
}

export class MemoryReplayStore {
  private readonly consumed = new Map<string, number>();

  consume(jti: string, ttlSeconds: number): boolean {
    this.sweep();
    if (this.consumed.has(jti)) return false;
    this.consumed.set(jti, Date.now() + ttlSeconds * 1000);
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.consumed) {
      if (expiresAt < now) this.consumed.delete(key);
    }
  }
}

/** Minimal in-memory sliding-window counter for the offline risk engine's
 * velocity/failure signals — a much weaker substitute for
 * @gatekeeper/rate-limit's Redis sliding window (no cross-process
 * visibility, no atomicity guarantee needed since it's advisory input to
 * risk scoring, not an enforcement boundary here). */
export class MemoryCounter {
  private readonly hits = new Map<string, number[]>();

  recordAndCount(key: string, windowMs: number): number {
    const now = Date.now();
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return timestamps.length;
  }

  peek(key: string, windowMs: number): number {
    const now = Date.now();
    return (this.hits.get(key) ?? []).filter((t) => t > now - windowMs).length;
  }
}
