import type { RiskLevel } from "@gatekeeper/shared";

export type GateDecision = "allow" | "challenge" | "hard_challenge" | "block";

export interface DecisionPolicy {
  lowRiskAutoAllow: boolean;
  criticalAction: "block" | "throttle";
}

const DEFAULT_POLICY: DecisionPolicy = { lowRiskAutoAllow: true, criticalAction: "block" };

/** Layer 7 adaptive escalation (docs/ARCHITECTURE.md): translates a risk
 * level into a concrete action. This mapping is intentionally simple and
 * centralized — every place in apps/api that needs to decide what to do
 * with a risk level calls this function rather than re-implementing the
 * table, so the policy documented in ARCHITECTURE.md and what the code
 * does can never drift apart. */
export function decideAction(level: RiskLevel, policy: DecisionPolicy = DEFAULT_POLICY): GateDecision {
  switch (level) {
    case "LOW":
      return policy.lowRiskAutoAllow ? "allow" : "challenge";
    case "MEDIUM":
      return "challenge";
    case "HIGH":
      return "hard_challenge";
    case "CRITICAL":
      return policy.criticalAction === "throttle" ? "hard_challenge" : "block";
  }
}

/** Suggested challenge difficulty (1-5) for a risk level, used when the
 * decision is `challenge` or `hard_challenge`. */
export function difficultyForLevel(level: RiskLevel): number {
  switch (level) {
    case "LOW":
      return 1;
    case "MEDIUM":
      return 2;
    case "HIGH":
      return 4;
    case "CRITICAL":
      return 5;
  }
}
