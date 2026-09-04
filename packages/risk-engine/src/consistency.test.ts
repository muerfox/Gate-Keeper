import { describe, expect, it } from "vitest";
import { analyzeInteractionConsistency } from "./consistency.js";
import type { InteractionEvent } from "@gatekeeper/shared";

function humanLikeEvents(): InteractionEvent[] {
  // Jittery, monotonic, matched down/up — what a real pointer stream looks like.
  const events: InteractionEvent[] = [];
  let t = 0;
  for (let i = 0; i < 10; i++) {
    t += 40 + (i % 3) * 17 + (i % 2); // irregular deltas
    events.push({ t, type: "pointermove", x: i * 5, y: i * 3 });
  }
  events.push({ t: t + 30, type: "pointerdown" });
  events.push({ t: t + 250, type: "pointerup" });
  return events;
}

function scriptedEvents(): InteractionEvent[] {
  // Perfectly uniform 16ms deltas — a scripted timer, not a human.
  const events: InteractionEvent[] = [];
  for (let i = 0; i < 10; i++) {
    events.push({ t: i * 16, type: "pointermove", x: i, y: i });
  }
  return events;
}

describe("analyzeInteractionConsistency", () => {
  it("finds nothing suspicious in a plausible human-like event stream", () => {
    const findings = analyzeInteractionConsistency(humanLikeEvents(), 2000, 900);
    expect(findings).toHaveLength(0);
  });

  it("flags non-monotonic timestamps as an impossible sequence", () => {
    const events: InteractionEvent[] = [
      { t: 100, type: "pointermove" },
      { t: 50, type: "pointermove" }, // time went backwards
    ];
    const findings = analyzeInteractionConsistency(events, 2000, 900);
    expect(findings.map((f) => f.reason)).toContain("non_monotonic_event_timestamps");
  });

  it("flags unmatched pointerdown/pointerup pairs", () => {
    const events: InteractionEvent[] = [
      { t: 10, type: "pointerdown" },
      { t: 20, type: "pointerdown" },
      { t: 30, type: "pointerdown" },
    ];
    const findings = analyzeInteractionConsistency(events, 2000, 900);
    expect(findings.map((f) => f.reason)).toContain("unmatched_pointer_down_up");
  });

  it("flags near-zero timing jitter as scripted", () => {
    const findings = analyzeInteractionConsistency(scriptedEvents(), 2000, 900);
    expect(findings.map((f) => f.reason)).toContain("near_zero_pointer_timing_jitter");
  });

  it("flags a solve time faster than the challenge's plausible minimum", () => {
    const findings = analyzeInteractionConsistency([], 50, 900);
    expect(findings.map((f) => f.reason)).toContain("solve_time_below_plausible_minimum");
  });

  it("does not flag a solve time at or above the plausible minimum", () => {
    const findings = analyzeInteractionConsistency([], 900, 900);
    expect(findings.map((f) => f.reason)).not.toContain("solve_time_below_plausible_minimum");
  });
});
