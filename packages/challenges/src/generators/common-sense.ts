import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureChoice, secureShuffle } from "../secure-random.js";

/** Plain-language multiple choice — no fine motor precision, no color or
 * shape discrimination, no timing pressure, and (unlike
 * `accessible_alternative`) part of the GENERAL rotation rather than an
 * accessibility-only fallback, so every session sees an easy option some
 * of the time, not only ones that explicitly requested one. This is a
 * deliberately weaker bot-resistance category on its own — a bot with a
 * small lookup table over these fixed question sets could pass it — which
 * is why it leans on the same accepted tradeoff as
 * `accessible_alternative` (docs/THREAT_MODEL.md §8): friendliness here
 * is backstopped by Layers 4-7 (risk engine, rate limiting, adaptive
 * escalation), not by this puzzle being hard to automate in isolation.
 */
const QUESTION_SETS = [
  { instruction: "Which of these can you eat?", correct: "an apple", options: ["an apple", "a brick", "a cloud", "a guitar"] },
  { instruction: "Which of these is a color?", correct: "purple", options: ["purple", "Tuesday", "an elbow", "thunder"] },
  { instruction: "Which of these would you find in the sky?", correct: "a cloud", options: ["a cloud", "a spoon", "a sofa", "a shoelace"] },
  { instruction: "Which of these is a day of the week?", correct: "Friday", options: ["Friday", "October", "breakfast", "silver"] },
  { instruction: "Which of these makes a sound when you play it?", correct: "a guitar", options: ["a guitar", "a pillow", "a window", "a carrot"] },
  { instruction: "Which of these is cold?", correct: "ice", options: ["ice", "fire", "sand", "soup"] },
  { instruction: "Which of these do you wear on your feet?", correct: "shoes", options: ["shoes", "a hat", "gloves", "a scarf"] },
  { instruction: "Which of these is a season?", correct: "winter", options: ["winter", "Monday", "breakfast", "attic"] },
] as const;

export const commonSenseChoiceGenerator: ChallengeGenerator = {
  type: "common_sense_choice",
  accessible: true,
  generate(): GeneratedChallenge {
    const set = secureChoice(QUESTION_SETS);
    const options = secureShuffle(set.options).map((text, i) => ({ id: `c${i}`, text }));
    const correct = options.find((o) => o.text === set.correct)!;

    return {
      type: "common_sense_choice",
      payload: {
        instruction: set.instruction,
        options,
      },
      expectedAnswer: correct.id,
      minPlausibleSolveMs: 400,
    };
  },
  verify(answer, expectedAnswer): boolean {
    return typeof answer === "string" && answer === expectedAnswer;
  },
};
