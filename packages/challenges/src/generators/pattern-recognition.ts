import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureChoice, secureRandomInt, secureShuffle } from "../secure-random.js";

const SHAPES = ["circle", "square", "triangle", "star", "hexagon"] as const;
const COLORS = ["red", "blue", "green", "amber"] as const;

/** Odd-one-out: every tile shares one attribute (shape or color) except a
 * single outlier. Difficulty controls grid size and whether the outlier
 * differs by shape (easier to spot) or by a more subtle attribute. */
export const patternRecognitionGenerator: ChallengeGenerator = {
  type: "pattern_recognition",
  accessible: false,
  generate(difficulty): GeneratedChallenge {
    const gridSize = Math.min(6 + difficulty, 12);
    const baseShape = secureChoice(SHAPES);
    const baseColor = secureChoice(COLORS);
    const varyColor = difficulty >= 3;

    const tiles = Array.from({ length: gridSize }, (_, i) => ({
      id: `p${i}`,
      shape: baseShape,
      color: varyColor ? secureChoice(COLORS) : baseColor,
    }));

    const oddIndex = secureRandomInt(0, gridSize);
    if (varyColor) {
      tiles[oddIndex] = { id: tiles[oddIndex]!.id, shape: secureChoice(SHAPES.filter((s) => s !== baseShape)), color: tiles[oddIndex]!.color };
    } else {
      tiles[oddIndex] = { id: tiles[oddIndex]!.id, shape: secureChoice(SHAPES.filter((s) => s !== baseShape)), color: baseColor };
    }

    return {
      type: "pattern_recognition",
      payload: {
        instruction: "Select the shape that does not belong with the others.",
        tiles: secureShuffle(tiles),
      },
      expectedAnswer: tiles[oddIndex]!.id,
      minPlausibleSolveMs: 800 + gridSize * 100,
    };
  },
  verify(answer, expectedAnswer): boolean {
    return typeof answer === "string" && answer === expectedAnswer;
  },
};
