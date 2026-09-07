import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureChoice, secureRandomInt, secureShuffle } from "../secure-random.js";

/** Reference icon vocabulary rendered as simple vector glyphs client-side
 * (see packages/captcha-client). A production deployment would plug a
 * richer, periodically-rotated photo/icon dataset into this same
 * ChallengeGenerator interface — the category, layout, and correct-item
 * count are randomized per challenge regardless of vocabulary size. */
const CATEGORIES = [
  { id: "vehicle", icons: ["car", "bicycle", "bus", "train"] },
  { id: "nature", icons: ["tree", "mountain", "leaf", "sun"] },
  { id: "building", icons: ["house", "tower", "bridge", "tent"] },
  { id: "animal", icons: ["cat", "bird", "fish", "turtle"] },
] as const;

const ALL_ICONS = CATEGORIES.flatMap((c) => c.icons);

function categoryOf(icon: string): string {
  return CATEGORIES.find((c) => (c.icons as readonly string[]).includes(icon))!.id;
}

export const imageClassificationGenerator: ChallengeGenerator = {
  type: "image_classification",
  accessible: false,
  generate(difficulty): GeneratedChallenge {
    const category = secureChoice(CATEGORIES);
    const tileCount = Math.min(6 + difficulty * 2, 16);
    const matchCount = secureRandomInt(2, Math.max(3, Math.floor(tileCount / 2)));

    const tiles = secureShuffle([
      ...Array.from({ length: matchCount }, () => secureChoice(category.icons)),
      ...Array.from({ length: tileCount - matchCount }, () =>
        secureChoice(ALL_ICONS.filter((i) => !(category.icons as readonly string[]).includes(i))),
      ),
    ]).map((icon, i) => ({ id: `i${i}`, icon }));

    const matchingIds = tiles.filter((t) => categoryOf(t.icon) === category.id).map((t) => t.id);

    return {
      type: "image_classification",
      payload: {
        instruction: `Select every image that shows a ${category.id}.`,
        tiles,
      },
      expectedAnswer: JSON.stringify(matchingIds.sort()),
      minPlausibleSolveMs: 900 + tileCount * 150,
    };
  },
  verify(answer, expectedAnswer): boolean {
    if (!Array.isArray(answer) || !answer.every((v) => typeof v === "string")) return false;
    return JSON.stringify([...(answer as string[])].sort()) === expectedAnswer;
  },
};
