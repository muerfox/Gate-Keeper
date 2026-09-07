import type { InteractionEvent, RiskLevel } from "@gatekeeper/shared";

/** Signals the risk engine consumes. Every field here is either observed
 * directly by the server (arrival timing, velocity) or derived from raw
 * client-reported events that are treated as evidence, never as a trusted
 * assertion (docs/THREAT_MODEL.md: "never trust the client"). There is
 * deliberately no `clientRiskScore` field — the client cannot submit its
 * own risk score (docs spec: "Never allow the client to directly submit
 * its own risk score"). */
export interface RiskSignals {
  /** Raw interaction events as reported by the widget for this challenge
   * attempt. Never assumed truthful; only used via internal-consistency
   * checks (see consistency.ts). */
  events: InteractionEvent[];
  /** Wall-clock ms between challenge issuance and this verify call, as
   * measured by the SERVER (issuedAt/now), not client-reported timing. */
  serverObservedSolveMs: number;
  /** The generator-declared minimum plausible human solve time for this
   * challenge instance (packages/challenges). */
  minPlausibleSolveMs: number;
  /** Requests for this action from this site in the recent window
   * (server-observed velocity, not client-reported). */
  recentRequestVelocity: number;
  /** Failed verification attempts from this session/IP in the recent
   * window. */
  recentFailureCount: number;
  /** Whether this exact challenge was already flagged as replayed/consumed
   * before this attempt (should never be true for a request reaching the
   * risk engine, but included so a defense-in-depth caller can pass it
   * through and have it dominate the score if seen). */
  replayDetected: boolean;
  /** Present only when the site has IP processing enabled
   * (docs/PRIVACY.md); a coarse reputation signal such as "known
   * datacenter/proxy range" — never a precise geolocation or persistent
   * identifier. */
  ipReputation?: "residential" | "datacenter" | "known_abusive" | "unknown";
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number; // 0 (certainly human) .. 100 (certainly automated)
  reasons: string[];
}
