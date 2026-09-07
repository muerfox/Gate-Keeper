import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureRandomInt } from "../secure-random.js";

/** Press-and-hold-until-signal challenge: the client must hold pointer/key
 * down until a randomly timed visual cue fires, then release within a
 * tolerance window. The *answer* here is trivial (a duration), but the
 * point of this category is the InteractionEvent stream it produces
 * (pointerdown at t0, pointerup at t0+heldMs) for the risk engine's
 * behavioral consistency check (Layer 3) — a scripted client replaying a
 * fixed delay, or one with zero jitter, is a strong corroborating signal,
 * never a sole pass/fail signal on its own. */
export const dynamicInteractionGenerator: ChallengeGenerator = {
  type: "dynamic_interaction",
  accessible: true,
  generate(difficulty): GeneratedChallenge {
    const cueDelayMs = secureRandomInt(1200, 1200 + difficulty * 400);
    const toleranceMs = Math.max(500 - difficulty * 40, 200);

    return {
      type: "dynamic_interaction",
      payload: {
        instruction: "Press and hold the button. Release as soon as it changes color.",
        cueDelayMs,
        toleranceMs,
      },
      expectedAnswer: JSON.stringify({ cueDelayMs, toleranceMs }),
      minPlausibleSolveMs: cueDelayMs,
    };
  },
  verify(answer, expectedAnswer): boolean {
    if (typeof answer !== "object" || answer === null) return false;
    const { heldMs } = answer as { heldMs?: unknown };
    if (typeof heldMs !== "number" || !Number.isFinite(heldMs)) return false;
    const { cueDelayMs, toleranceMs } = JSON.parse(expectedAnswer) as { cueDelayMs: number; toleranceMs: number };
    return Math.abs(heldMs - cueDelayMs) <= toleranceMs;
  },
};
