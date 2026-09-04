import type { InteractionEvent } from "@gatekeeper/shared";

export interface ConsistencyFinding {
  reason: string;
  weight: number; // 0-100 contribution to the suspicion score
}

/**
 * Behavioral consistency analysis (Layer 3, docs/ARCHITECTURE.md).
 *
 * Deliberately does NOT ask "did pointer events exist" — that single
 * boolean is trivially spoofable. Instead it looks for *internal*
 * contradictions across independent event channels that are individually
 * easy to fake but expensive to fake consistently together: timestamp
 * ordering, matched down/up pairs, timing jitter, and plausibility against
 * the challenge's own declared minimum solve time. No single finding here
 * is treated as a hard fail by itself — see docs/THREAT_MODEL.md §4.9 and
 * §8 (false-positive risk) for why this stays probabilistic evidence
 * feeding the risk score, not a pass/fail gate.
 */
export function analyzeInteractionConsistency(
  events: InteractionEvent[],
  serverObservedSolveMs: number,
  minPlausibleSolveMs: number,
): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];

  findings.push(...checkMonotonicTimestamps(events));
  findings.push(...checkMatchedPointerPairs(events));
  findings.push(...checkTimingJitter(events));
  findings.push(...checkPlausibleSolveTime(serverObservedSolveMs, minPlausibleSolveMs));

  return findings;
}

function checkMonotonicTimestamps(events: InteractionEvent[]): ConsistencyFinding[] {
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const curr = events[i]!;
    if (curr.t < prev.t) {
      return [{ reason: "non_monotonic_event_timestamps", weight: 40 }];
    }
  }
  return [];
}

function checkMatchedPointerPairs(events: InteractionEvent[]): ConsistencyFinding[] {
  let downCount = 0;
  let upCount = 0;
  for (const e of events) {
    if (e.type === "pointerdown") downCount++;
    if (e.type === "pointerup") upCount++;
  }
  if (downCount === 0 && upCount === 0) return [];
  const imbalance = Math.abs(downCount - upCount);
  if (imbalance === 0) return [];
  return [{ reason: "unmatched_pointer_down_up", weight: Math.min(15 * imbalance, 30) }];
}

/** A scripted client that "moves the mouse" with a fixed setInterval
 * produces near-zero variance between consecutive event timestamps. Real
 * human input — even fast, even from assistive tech — has measurable
 * jitter. This check only fires when there are enough samples to be
 * statistically meaningful, and treats a small amount of periodicity as
 * normal (a CSS-driven or requestAnimationFrame-paced UI can be fairly
 * regular too). */
function checkTimingJitter(events: InteractionEvent[]): ConsistencyFinding[] {
  const moveEvents = events.filter((e) => e.type === "pointermove");
  if (moveEvents.length < 6) return [];

  const intervals: number[] = [];
  for (let i = 1; i < moveEvents.length; i++) {
    intervals.push(moveEvents[i]!.t - moveEvents[i - 1]!.t);
  }
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean === 0) return [{ reason: "zero_interval_pointer_events", weight: 35 }];

  const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
  const stdev = Math.sqrt(variance);
  const coefficientOfVariation = stdev / mean;

  if (coefficientOfVariation < 0.02) {
    return [{ reason: "near_zero_pointer_timing_jitter", weight: 25 }];
  }
  return [];
}

function checkPlausibleSolveTime(serverObservedSolveMs: number, minPlausibleSolveMs: number): ConsistencyFinding[] {
  if (minPlausibleSolveMs <= 0) return [];
  if (serverObservedSolveMs >= minPlausibleSolveMs) return [];

  const deficitRatio = 1 - serverObservedSolveMs / minPlausibleSolveMs;
  return [{ reason: "solve_time_below_plausible_minimum", weight: Math.round(30 * deficitRatio) }];
}
