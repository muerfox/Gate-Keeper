import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureChoice, secureRandomInt, secureShuffle } from "../secure-random.js";

const SHAPES = ["circle", "square", "triangle", "star", "hexagon", "pentagon"] as const;
const COLORS = ["red", "blue", "green", "amber", "violet", "teal"] as const;

export interface VisualTile {
  id: string;
  shape: (typeof SHAPES)[number];
  color: (typeof COLORS)[number];
  rotationDeg: number;
  x: number;
  y: number;
}

/** Procedurally generated grid-selection challenge. Every tile is rendered
 * client-side from structured data (shape/color/rotation/position) rather
 * than shipped as a static image bank — the grid, the target attribute
 * combination, and the number of correct tiles are all re-randomized per
 * challenge, so there is no fixed question/answer set to memorize or scrape
 * (docs/THREAT_MODEL.md: "do not use a small static collection"). */
function buildGrid(tileCount: number): { tiles: VisualTile[]; targetShape: (typeof SHAPES)[number]; targetColor: (typeof COLORS)[number] } {
  const targetShape = secureChoice(SHAPES);
  const targetColor = secureChoice(COLORS);
  const cols = 4;
  const rows = Math.ceil(tileCount / cols);
  const positions = secureShuffle(
    Array.from({ length: rows * cols }, (_, i) => ({ x: (i % cols) * 25 + 12, y: Math.floor(i / cols) * 25 + 12 })),
  ).slice(0, tileCount);

  // Ensure at least 2 and at most (tileCount - 2) tiles match the target so
  // the challenge is neither trivial nor impossible.
  const matchCount = secureRandomInt(2, Math.max(3, Math.floor(tileCount / 2)));
  const tiles: VisualTile[] = positions.map((pos, i) => {
    const isMatch = i < matchCount;
    const shape = isMatch ? targetShape : secureChoice(SHAPES.filter((s) => s !== targetShape || !isMatch));
    const color = isMatch ? targetColor : secureChoice(COLORS);
    return {
      id: `t${i}`,
      shape: isMatch ? targetShape : shape,
      color: isMatch ? targetColor : color,
      rotationDeg: secureRandomInt(0, 360),
      x: pos.x,
      y: pos.y,
    };
  });

  return { tiles: secureShuffle(tiles), targetShape, targetColor };
}

export const visualObjectSelectionGenerator: ChallengeGenerator = {
  type: "visual_object_selection",
  accessible: false,
  generate(difficulty): GeneratedChallenge {
    const tileCount = Math.min(6 + difficulty * 2, 16);
    const { tiles, targetShape, targetColor } = buildGrid(tileCount);
    const matchingIds = tiles.filter((t) => t.shape === targetShape && t.color === targetColor).map((t) => t.id);

    return {
      type: "visual_object_selection",
      payload: {
        instruction: `Select every ${targetColor} ${targetShape}.`,
        tiles: tiles.map(({ id, shape, color, rotationDeg, x, y }) => ({ id, shape, color, rotationDeg, x, y })),
      },
      expectedAnswer: JSON.stringify(matchingIds.sort()),
      minPlausibleSolveMs: 900 + tileCount * 120,
    };
  },
  verify(answer, expectedAnswer): boolean {
    if (!Array.isArray(answer) || !answer.every((v) => typeof v === "string")) return false;
    const submitted = JSON.stringify([...(answer as string[])].sort());
    return submitted === expectedAnswer;
  },
};
