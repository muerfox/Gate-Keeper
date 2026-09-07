import type { ChallengeType } from "@gatekeeper/shared";
import type { ChallengeGenerator, GeneratedChallenge } from "./types.js";
import { visualObjectSelectionGenerator } from "./generators/visual-selection.js";
import { imageClassificationGenerator } from "./generators/image-classification.js";
import { spatialReasoningGenerator } from "./generators/spatial-reasoning.js";
import { sequenceRecognitionGenerator } from "./generators/sequence-recognition.js";
import { dragDropGenerator } from "./generators/drag-drop.js";
import { rotationGenerator } from "./generators/rotation.js";
import { patternRecognitionGenerator } from "./generators/pattern-recognition.js";
import { dynamicInteractionGenerator } from "./generators/dynamic-interaction.js";
import { proofOfWorkGenerator } from "./generators/proof-of-work.js";
import { cryptographicProofGenerator } from "./generators/cryptographic-proof.js";
import { accessibleAlternativeGenerator } from "./generators/accessible-alternative.js";
import { secureChoice } from "./secure-random.js";

const REGISTRY: Record<ChallengeType, ChallengeGenerator> = {
  visual_object_selection: visualObjectSelectionGenerator,
  image_classification: imageClassificationGenerator,
  spatial_reasoning: spatialReasoningGenerator,
  sequence_recognition: sequenceRecognitionGenerator,
  dynamic_interaction: dynamicInteractionGenerator,
  drag_drop: dragDropGenerator,
  rotation: rotationGenerator,
  pattern_recognition: patternRecognitionGenerator,
  proof_of_work: proofOfWorkGenerator,
  cryptographic_proof: cryptographicProofGenerator,
  accessible_alternative: accessibleAlternativeGenerator,
};

export const INTERACTIVE_CHALLENGE_TYPES: ChallengeType[] = [
  "visual_object_selection",
  "image_classification",
  "spatial_reasoning",
  "sequence_recognition",
  "drag_drop",
  "rotation",
  "pattern_recognition",
];

export const ACCESSIBLE_CHALLENGE_TYPES: ChallengeType[] = Object.values(REGISTRY)
  .filter((g) => g.accessible)
  .map((g) => g.type);

export interface ChallengeEngineOptions {
  /** If true, only accessible-alternative-eligible types are selected
   * (screen-reader/keyboard-only sessions, see docs/ACCESSIBILITY.md). */
  requireAccessible?: boolean;
  /** If false, PoW/cryptographic-proof types are excluded entirely — an
   * administrator toggle (docs/THREAT_MODEL.md: "allow administrators to
   * disable computational challenges"). */
  allowComputational?: boolean;
  /** Explicit type override, e.g. for a fixed accessible fallback link. */
  forceType?: ChallengeType;
}

export function selectChallengeType(options: ChallengeEngineOptions = {}): ChallengeType {
  if (options.forceType) return options.forceType;

  let pool = options.requireAccessible ? ACCESSIBLE_CHALLENGE_TYPES : INTERACTIVE_CHALLENGE_TYPES;
  if (options.allowComputational === false) {
    pool = pool.filter((t) => t !== "proof_of_work" && t !== "cryptographic_proof");
  }
  if (pool.length === 0) pool = ["accessible_alternative"];
  return secureChoice(pool);
}

export function generateChallenge(type: ChallengeType, difficulty: number): GeneratedChallenge {
  const generator = REGISTRY[type];
  const clamped = Math.min(Math.max(Math.round(difficulty), 1), 5);
  return generator.generate(clamped);
}

export function verifyChallengeAnswer(
  type: ChallengeType,
  answer: unknown,
  expectedAnswer: string,
  difficulty: number,
): boolean {
  const generator = REGISTRY[type];
  return generator.verify(answer, expectedAnswer, difficulty);
}

export function getGenerator(type: ChallengeType): ChallengeGenerator {
  return REGISTRY[type];
}
