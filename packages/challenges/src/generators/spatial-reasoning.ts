import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureChoice, secureRandomInt, secureShuffle } from "../secure-random.js";

const SHAPES = ["triangle", "square", "pentagon", "hexagon"] as const;

/** Shows a sequence of the same shape rotated by a constant step and asks
 * which of several options continues the sequence. Difficulty scales the
 * rotation step's subtlety and the number of plausible distractors. */
export const spatialReasoningGenerator: ChallengeGenerator = {
  type: "spatial_reasoning",
  accessible: false,
  generate(difficulty): GeneratedChallenge {
    const shape = secureChoice(SHAPES);
    const sequenceLength = 3;
    const step = secureChoice([30, 45, 60, 72, 90].filter((s) => difficulty >= 3 || s >= 45));
    const start = secureRandomInt(0, 360);
    const sequence = Array.from({ length: sequenceLength }, (_, i) => (start + i * step) % 360);
    const correctNext = (start + sequenceLength * step) % 360;

    const distractorCount = Math.min(2 + difficulty, 5);
    const distractors = new Set<number>();
    while (distractors.size < distractorCount) {
      const d = (correctNext + secureChoice([15, -15, 20, -20, 30, -30, step / 2])) % 360;
      const normalized = ((d % 360) + 360) % 360;
      if (normalized !== correctNext) distractors.add(normalized);
    }

    const options = secureShuffle([correctNext, ...distractors]).map((angle, i) => ({ id: `o${i}`, angle }));
    const correctOption = options.find((o) => o.angle === correctNext)!;

    return {
      type: "spatial_reasoning",
      payload: {
        instruction: "Select the shape that continues the rotation sequence.",
        shape,
        sequence,
        options,
      },
      expectedAnswer: correctOption.id,
      minPlausibleSolveMs: 1200,
    };
  },
  verify(answer, expectedAnswer): boolean {
    return typeof answer === "string" && answer === expectedAnswer;
  },
};
