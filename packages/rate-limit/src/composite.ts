import type { SlidingWindowLimiter } from "./sliding-window.js";
import type { TokenBucketLimiter } from "./token-bucket.js";

/** Everything a rate-limit decision might key on. Individual rules pick
 * which fields they care about — this is what lets Gate Keeper enforce IP,
 * site, action, session, challenge, token, and API-key limits
 * simultaneously (docs spec: "Implement multiple levels") without an
 * attacker being able to dodge all of them by only varying one dimension. */
export interface RateLimitContext {
  ip?: string;
  siteId?: string;
  action?: string;
  sessionId?: string;
  apiKeyId?: string;
}

export type RuleAlgorithm =
  | { kind: "sliding_window"; limit: number; windowMs: number }
  | { kind: "token_bucket"; capacity: number; refillPerSecond: number };

export interface RateLimitRule {
  name: string;
  /** Returns the dimension key to rate-limit on, or undefined to skip this
   * rule for a request that doesn't have the relevant field (e.g. an
   * unauthenticated request has no apiKeyId). */
  dimension: (ctx: RateLimitContext) => string | undefined;
  algorithm: RuleAlgorithm;
}

export interface RuleOutcome {
  rule: string;
  allowed: boolean;
  detail: { count: number; resetAt: number } | { remaining: number };
}

export interface CompositeResult {
  allowed: boolean;
  /** The first rule that denied the request, if any — used for security
   * event logging so operators can see *which* limit an attacker is
   * hitting. */
  violatedRule?: string;
  outcomes: RuleOutcome[];
}

/**
 * Evaluates every applicable rule for a request. Deliberately evaluates
 * (and thus increments/debits) ALL applicable rules rather than
 * short-circuiting on the first denial: an attacker who could make only the
 * dimension that would deny them "free" (by having it skipped once another
 * dimension already failed) could selectively avoid ever tripping that
 * counter. Every rule that applies to this request is charged one unit of
 * usage regardless of the others' outcomes.
 */
export class CompositeRateLimiter {
  constructor(
    private readonly slidingWindow: SlidingWindowLimiter,
    private readonly tokenBucket: TokenBucketLimiter,
    private readonly rules: RateLimitRule[],
  ) {}

  async check(ctx: RateLimitContext): Promise<CompositeResult> {
    const outcomes: RuleOutcome[] = [];

    for (const rule of this.rules) {
      const dimensionKey = rule.dimension(ctx);
      if (dimensionKey === undefined) continue;

      const key = `${rule.name}:${dimensionKey}`;
      if (rule.algorithm.kind === "sliding_window") {
        const result = await this.slidingWindow.check(key, rule.algorithm.limit, rule.algorithm.windowMs);
        outcomes.push({ rule: rule.name, allowed: result.allowed, detail: { count: result.count, resetAt: result.resetAt } });
      } else {
        const result = await this.tokenBucket.check(key, rule.algorithm.capacity, rule.algorithm.refillPerSecond);
        outcomes.push({ rule: rule.name, allowed: result.allowed, detail: { remaining: result.remaining } });
      }
    }

    const violated = outcomes.find((o) => !o.allowed);
    return { allowed: violated === undefined, violatedRule: violated?.rule, outcomes };
  }
}
