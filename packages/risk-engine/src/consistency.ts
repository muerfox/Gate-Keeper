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
  findings.push(...checkTeleportingPointer(events));
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

/** A synthetic event dispatcher can set `clientX`/`clientY` to any value
 * it likes with no intermediate samples — a real pointer, however fast,
 * cannot cross a large on-screen distance between two adjacent samples
 * with (near) zero elapsed time. The threshold here (50 px/ms, i.e.
 * 50,000 px/sec) is set well above anything a physical mouse or trackpad
 * can produce even during a fast flick, specifically so this only fires
 * on movement that no pointing device could have generated — not on
 * merely fast, real input. Small deltas are ignored outright since
 * sub-pixel/rounding jitter at a tiny time delta isn't evidence of
 * anything. */
function checkTeleportingPointer(events: InteractionEvent[]): ConsistencyFinding[] {
  const MIN_DISTANCE_PX = 30;
  const MAX_PLAUSIBLE_PX_PER_MS = 50;

  const moves = events.filter(
    (e): e is InteractionEvent & { x: number; y: number } => e.type === "pointermove" && typeof e.x === "number" && typeof e.y === "number",
  );
  if (moves.length < 2) return [];

  let worstRatio = 0;
  for (let i = 1; i < moves.length; i++) {
    const prev = moves[i - 1]!;
    const curr = moves[i]!;
    const distance = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (distance < MIN_DISTANCE_PX) continue;

    const dt = curr.t - prev.t;
    // dt <= 0 alongside a real distance means "moved before time elapsed"
    // — treat as maximally implausible rather than dividing by zero.
    const speed = dt <= 0 ? Number.POSITIVE_INFINITY : distance / dt;
    worstRatio = Math.max(worstRatio, speed / MAX_PLAUSIBLE_PX_PER_MS);
  }

  if (worstRatio <= 1) return [];
  return [{ reason: "pointer_teleport_implausible_speed", weight: Math.min(Math.round(20 * worstRatio), 45) }];
}

function checkPlausibleSolveTime(serverObservedSolveMs: number, minPlausibleSolveMs: number): ConsistencyFinding[] {
  if (minPlausibleSolveMs <= 0) return [];
  if (serverObservedSolveMs >= minPlausibleSolveMs) return [];

  const deficitRatio = 1 - serverObservedSolveMs / minPlausibleSolveMs;
  return [{ reason: "solve_time_below_plausible_minimum", weight: Math.round(30 * deficitRatio) }];
}
