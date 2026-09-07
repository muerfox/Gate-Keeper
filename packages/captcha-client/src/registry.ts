import type { ChallengeType } from "@gatekeeper/shared";
import type { ChallengeRenderer } from "./types.js";
import { tileSelectionRenderer } from "./renderers/tile-selection.js";
import { makeSingleSelectRenderer } from "./renderers/single-select.js";
import { sequenceRecognitionRenderer } from "./renderers/sequence-recognition.js";
import { dragDropRenderer } from "./renderers/drag-drop.js";
import { rotationRenderer } from "./renderers/rotation.js";
import { dynamicInteractionRenderer } from "./renderers/dynamic-interaction.js";
import { accessibleAlternativeRenderer } from "./renderers/accessible-alternative.js";
import { proofOfWorkRenderer, cryptographicProofRenderer } from "./renderers/computational.js";

export const RENDERERS: Record<ChallengeType, ChallengeRenderer> = {
  visual_object_selection: tileSelectionRenderer,
  image_classification: tileSelectionRenderer,
  spatial_reasoning: makeSingleSelectRenderer("spatial_reasoning"),
  pattern_recognition: makeSingleSelectRenderer("pattern_recognition"),
  sequence_recognition: sequenceRecognitionRenderer,
  drag_drop: dragDropRenderer,
  rotation: rotationRenderer,
  dynamic_interaction: dynamicInteractionRenderer,
  accessible_alternative: accessibleAlternativeRenderer,
  proof_of_work: proofOfWorkRenderer,
  cryptographic_proof: cryptographicProofRenderer,
};
