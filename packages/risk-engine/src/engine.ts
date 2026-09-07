import type { RiskLevel } from "@gatekeeper/shared";
import { analyzeInteractionConsistency } from "./consistency.js";
import type { RiskAssessment, RiskSignals } from "./types.js";

/** Score thresholds mapping the continuous 0-100 suspicion score to the
 * four discrete levels the rest of Gate Keeper acts on
 * (docs/ARCHITECTURE.md §Risk Engine output contract). Kept as named
 * constants (not scattered magic numbers) so an operator-facing config
 * layer in apps/api can override them per site without touching this
 * package. */
export const DEFAULT_THRESHOLDS = {
  mediumAt: 25,
  highAt: 55,
  criticalAt: 80,
};

export interface RiskEngineOptions {
  thresholds?: typeof DEFAULT_THRESHOLDS;
}

/**
 * Combines behavioral consistency findings with server-observed velocity,
 * failure history, and (optional, privacy-gated) IP reputation into one
 * risk level. This function is the ONLY place a risk decision is made —
 * every input is either server-observed or derived from client data via
 * the consistency analyzer above; nothing here reads a client-submitted
 * score (docs spec: "Never allow the client to directly submit its own
 * risk score").
 */
export function assessRisk(signals: RiskSignals, options: RiskEngineOptions = {}): RiskAssessment {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const reasons: string[] = [];
  let score = 0;

  if (signals.replayDetected) {
    // A detected replay is decisive on its own — this is not a
    // probabilistic signal, it's a confirmed protocol violation.
    return { level: "CRITICAL", score: 100, reasons: ["replay_detected"] };
  }

  const consistencyFindings = analyzeInteractionConsistency(
    signals.events,
    signals.serverObservedSolveMs,
    signals.minPlausibleSolveMs,
  );
  for (const finding of consistencyFindings) {
    score += finding.weight;
    reasons.push(finding.reason);
  }

  if (signals.recentRequestVelocity > 30) {
    score += Math.min(30, Math.floor(signals.recentRequestVelocity / 5));
    reasons.push("elevated_request_velocity");
  }

  if (signals.recentFailureCount > 0) {
    score += Math.min(30, signals.recentFailureCount * 8);
    reasons.push("recent_failure_history");
  }

  if (signals.ipReputation === "known_abusive") {
    score += 35;
    reasons.push("ip_reputation_known_abusive");
  } else if (signals.ipReputation === "datacenter") {
    // Weak signal only — many legitimate users (corporate VPNs, privacy
    // tools) also originate from datacenter ranges; see
    // docs/THREAT_MODEL.md §8 false-positive risks.
    score += 8;
    reasons.push("ip_reputation_datacenter");
  }

  score = Math.min(Math.max(Math.round(score), 0), 100);

  return { level: levelForScore(score, thresholds), score, reasons };
}

function levelForScore(score: number, thresholds: typeof DEFAULT_THRESHOLDS): RiskLevel {
  if (score >= thresholds.criticalAt) return "CRITICAL";
  if (score >= thresholds.highAt) return "HIGH";
  if (score >= thresholds.mediumAt) return "MEDIUM";
  return "LOW";
}
