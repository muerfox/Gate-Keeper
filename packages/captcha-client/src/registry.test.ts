import { describe, expect, it } from "vitest";
import { RENDERERS } from "./registry.js";
import type { ChallengeType } from "@gatekeeper/shared";

const ALL_TYPES: ChallengeType[] = [
  "visual_object_selection",
  "image_classification",
  "spatial_reasoning",
  "sequence_recognition",
  "dynamic_interaction",
  "drag_drop",
  "rotation",
  "pattern_recognition",
  "proof_of_work",
  "cryptographic_proof",
  "accessible_alternative",
];

describe("RENDERERS registry", () => {
  it.each(ALL_TYPES)("has a renderer registered for %s", (type) => {
    expect(RENDERERS[type]).toBeDefined();
    expect(typeof RENDERERS[type].render).toBe("function");
  });
});
