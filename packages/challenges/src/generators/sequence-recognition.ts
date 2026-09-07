import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureChoice } from "../secure-random.js";

const SYMBOLS = ["circle", "square", "triangle", "star", "diamond", "hexagon"] as const;

/** "Simon says"-style sequence playback. The client shows the sequence once
 * (timed, so it cannot be OCR'd from a single static frame the way a static
 * CAPTCHA image can), then the user reproduces it by clicking symbols in
 * order. Sequence length scales with difficulty. */
export const sequenceRecognitionGenerator: ChallengeGenerator = {
  type: "sequence_recognition",
  accessible: false,
  generate(difficulty): GeneratedChallenge {
    const length = Math.min(3 + difficulty, 8);
    const paletteSize = Math.min(4 + Math.floor(difficulty / 2), SYMBOLS.length);
    const palette = SYMBOLS.slice(0, paletteSize);
    const sequence = Array.from({ length }, () => secureChoice(palette));

    return {
      type: "sequence_recognition",
      payload: {
        instruction: "Watch the sequence, then repeat it by selecting the symbols in the same order.",
        palette,
        sequence,
        revealMsPerStep: 650,
      },
      expectedAnswer: JSON.stringify(sequence),
      minPlausibleSolveMs: length * 400,
    };
  },
  verify(answer, expectedAnswer): boolean {
    if (!Array.isArray(answer)) return false;
    return JSON.stringify(answer) === expectedAnswer;
  },
};
