import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureChoice, secureShuffle } from "../secure-random.js";

/** Fully keyboard-operable, screen-reader-friendly alternative that depends
 * on none of: vision, hearing, fine pointer control, or reaction speed. By
 * design this is easier to automate than the visual/motor categories — see
 * docs/ACCESSIBILITY.md and docs/THREAT_MODEL.md §8 for why that is an
 * accepted, explicit tradeoff: sessions using this path lean more heavily
 * on Layers 4-7 (risk engine, rate limiting, adaptive escalation) rather
 * than on puzzle difficulty, so accessibility is never achieved by making
 * the system easier to abuse overall. */
const WORD_SETS = [
  { correctCategory: "a color", words: ["amber", "bicycle", "lantern", "orchestra"] },
  { correctCategory: "an animal", words: ["turtle", "umbrella", "keyboard", "mountain"] },
  { correctCategory: "a number word", words: ["seven", "harbor", "whistle", "granite"] },
  { correctCategory: "a fruit", words: ["mango", "compass", "ladder", "thunder"] },
] as const;

export const accessibleAlternativeGenerator: ChallengeGenerator = {
  type: "accessible_alternative",
  accessible: true,
  generate(): GeneratedChallenge {
    const set = secureChoice(WORD_SETS);
    const options = secureShuffle(set.words).map((word, i) => ({ id: `w${i}`, word }));
    const correct = options.find((o) => o.word === set.words[0])!;

    return {
      type: "accessible_alternative",
      payload: {
        instruction: `Using the arrow keys or Tab, select the word that is ${set.correctCategory}.`,
        options,
      },
      expectedAnswer: correct.id,
      minPlausibleSolveMs: 500,
    };
  },
  verify(answer, expectedAnswer): boolean {
    return typeof answer === "string" && answer === expectedAnswer;
  },
};
