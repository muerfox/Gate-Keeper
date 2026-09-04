import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureChoice, secureRandomInt } from "../secure-random.js";

const SHAPES = ["arrow", "key", "wrench", "flag"] as const;

/** Rotate an asymmetric shape (via slider or drag) until it matches a
 * randomly chosen target orientation, within a tolerance that tightens as
 * difficulty increases. Asymmetric shapes are required so every angle in
 * [0, 360) has a visually distinguishable correct answer. */
export const rotationGenerator: ChallengeGenerator = {
  type: "rotation",
  accessible: false,
  generate(difficulty): GeneratedChallenge {
    const shape = secureChoice(SHAPES);
    const startRotationDeg = secureRandomInt(0, 360);
    const targetRotationDeg = secureRandomInt(0, 360);
    const toleranceDeg = Math.max(12 - difficulty * 2, 4);

    return {
      type: "rotation",
      payload: {
        instruction: "Rotate the shape to match the target orientation.",
        shape,
        startRotationDeg,
        targetRotationDeg,
        toleranceDeg,
      },
      expectedAnswer: JSON.stringify({ targetRotationDeg, toleranceDeg }),
      minPlausibleSolveMs: 1000,
    };
  },
  verify(answer, expectedAnswer): boolean {
    if (typeof answer !== "number" || !Number.isFinite(answer)) return false;
    const { targetRotationDeg, toleranceDeg } = JSON.parse(expectedAnswer) as {
      targetRotationDeg: number;
      toleranceDeg: number;
    };
    const diff = Math.abs((((answer - targetRotationDeg) % 360) + 540) % 360 - 180);
    return diff <= toleranceDeg;
  },
};
