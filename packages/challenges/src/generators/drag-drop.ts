import type { ChallengeGenerator, GeneratedChallenge } from "../types.js";
import { secureShuffle } from "../secure-random.js";

const SHAPES = ["circle", "square", "triangle", "star"] as const;

/** Drag each labeled item into the drop zone with the matching outline.
 * Answer is a mapping of itemId -> zoneId, order-independent. The client is
 * responsible for emitting drag/drop InteractionEvents so the risk engine
 * (Layer 3) can cross-check the reported mapping against a plausible
 * pointer trajectory. */
export const dragDropGenerator: ChallengeGenerator = {
  type: "drag_drop",
  accessible: false,
  generate(difficulty): GeneratedChallenge {
    const count = Math.min(3 + Math.floor(difficulty / 2), SHAPES.length);
    const shapes = SHAPES.slice(0, count);
    const zoneOrder = secureShuffle(shapes);
    const itemOrder = secureShuffle(shapes);

    const items = itemOrder.map((shape, i) => ({ id: `item-${i}`, shape }));
    const zones = zoneOrder.map((shape, i) => ({ id: `zone-${i}`, shape }));

    const mapping: Record<string, string> = {};
    for (const item of items) {
      const zone = zones.find((z) => z.shape === item.shape)!;
      mapping[item.id] = zone.id;
    }

    return {
      type: "drag_drop",
      payload: {
        instruction: "Drag each shape onto the outline that matches it.",
        items,
        zones,
      },
      expectedAnswer: JSON.stringify(mapping),
      minPlausibleSolveMs: count * 700,
    };
  },
  verify(answer, expectedAnswer): boolean {
    if (typeof answer !== "object" || answer === null) return false;
    const expected = JSON.parse(expectedAnswer) as Record<string, string>;
    const submitted = answer as Record<string, unknown>;
    const expectedKeys = Object.keys(expected);
    if (expectedKeys.length !== Object.keys(submitted).length) return false;
    return expectedKeys.every((k) => submitted[k] === expected[k]);
  },
};
