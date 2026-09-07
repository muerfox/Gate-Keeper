import { describe, expect, it } from "vitest";
import { assessRisk } from "./engine.js";
import { decideAction, difficultyForLevel } from "./decision.js";
import type { RiskSignals } from "./types.js";

function baseSignals(overrides: Partial<RiskSignals> = {}): RiskSignals {
  return {
    events: [],
    serverObservedSolveMs: 2000,
    minPlausibleSolveMs: 900,
    recentRequestVelocity: 1,
    recentFailureCount: 0,
    replayDetected: false,
    ...overrides,
  };
}

describe("assessRisk", () => {
  it("scores a clean, plausible attempt as LOW", () => {
    const result = assessRisk(baseSignals());
    expect(result.level).toBe("LOW");
  });

  it("treats a detected replay as CRITICAL regardless of other signals", () => {
    const result = assessRisk(baseSignals({ replayDetected: true, serverObservedSolveMs: 5000 }));
    expect(result.level).toBe("CRITICAL");
    expect(result.score).toBe(100);
  });

  it("escalates with recent failure history", () => {
    const clean = assessRisk(baseSignals());
    const withFailures = assessRisk(baseSignals({ recentFailureCount: 4 }));
    expect(withFailures.score).toBeGreaterThan(clean.score);
  });

  it("escalates with elevated request velocity", () => {
    const clean = assessRisk(baseSignals());
    const highVelocity = assessRisk(baseSignals({ recentRequestVelocity: 200 }));
    expect(highVelocity.score).toBeGreaterThan(clean.score);
  });

  it("never reads a client-submitted score (no such field exists on the input type)", () => {
    const signals = baseSignals();
    expect(signals).not.toHaveProperty("clientRiskScore");
    expect(signals).not.toHaveProperty("riskScore");
  });

  it("escalates well above LOW for an implausibly fast solve combined with scripted timing", () => {
    const clean = assessRisk(baseSignals());
    const scripted = Array.from({ length: 10 }, (_, i) => ({ t: i * 16, type: "pointermove" as const }));
    const result = assessRisk(baseSignals({ events: scripted, serverObservedSolveMs: 100 }));
    expect(["MEDIUM", "HIGH", "CRITICAL"]).toContain(result.level);
    expect(result.score).toBeGreaterThan(clean.score);
    expect(result.reasons).toContain("near_zero_pointer_timing_jitter");
    expect(result.reasons).toContain("solve_time_below_plausible_minimum");
  });
});

describe("decideAction", () => {
  it("maps LOW to allow by default", () => {
    expect(decideAction("LOW")).toBe("allow");
  });
  it("maps MEDIUM to challenge", () => {
    expect(decideAction("MEDIUM")).toBe("challenge");
  });
  it("maps HIGH to hard_challenge", () => {
    expect(decideAction("HIGH")).toBe("hard_challenge");
  });
  it("maps CRITICAL to block by default", () => {
    expect(decideAction("CRITICAL")).toBe("block");
  });
  it("respects lowRiskAutoAllow=false", () => {
    expect(decideAction("LOW", { lowRiskAutoAllow: false, criticalAction: "block" })).toBe("challenge");
  });
  it("respects criticalAction=throttle", () => {
    expect(decideAction("CRITICAL", { lowRiskAutoAllow: true, criticalAction: "throttle" })).toBe("hard_challenge");
  });
});

describe("difficultyForLevel", () => {
  it("increases monotonically with risk", () => {
    expect(difficultyForLevel("LOW")).toBeLessThan(difficultyForLevel("MEDIUM"));
    expect(difficultyForLevel("MEDIUM")).toBeLessThan(difficultyForLevel("HIGH"));
    expect(difficultyForLevel("HIGH")).toBeLessThanOrEqual(difficultyForLevel("CRITICAL"));
  });
});
