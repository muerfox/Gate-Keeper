export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ChallengeType =
  | "visual_object_selection"
  | "image_classification"
  | "spatial_reasoning"
  | "sequence_recognition"
  | "dynamic_interaction"
  | "drag_drop"
  | "rotation"
  | "pattern_recognition"
  | "proof_of_work"
  | "cryptographic_proof"
  | "accessible_alternative";

/** Public, client-safe representation of an issued challenge. Never includes
 * the expected answer or answer hash. */
export interface PublicChallenge {
  id: string;
  type: ChallengeType;
  difficulty: number;
  siteId: string;
  action: string;
  issuedAt: number;
  expiresAt: number;
  /** Type-specific data needed to render the challenge (image refs, grid
   * layout, PoW target, etc.) — never the solution. */
  payload: Record<string, unknown>;
  /** Compact signed representation clients must echo back unmodified. */
  signedEnvelope: string;
}

export interface InteractionEvent {
  /** Monotonic client timestamp (ms since challenge render), NOT wall clock,
   * to reduce the value of clock tampering. */
  t: number;
  type:
    | "pointermove"
    | "pointerdown"
    | "pointerup"
    | "keydown"
    | "keyup"
    | "focus"
    | "blur"
    | "visibilitychange"
    | "drag"
    | "drop";
  x?: number;
  y?: number;
  key?: string;
}

export type VerificationOutcome =
  | "SUCCESS"
  | "FAILED_ANSWER"
  | "EXPIRED"
  | "ALREADY_CONSUMED"
  | "RISK_BLOCKED"
  | "RATE_LIMITED"
  | "INVALID_SIGNATURE"
  | "SITE_MISMATCH"
  | "ACTION_MISMATCH"
  /** The submitted answer was correct, but post-answer behavioral risk
   * analysis (Layer 3/4) requires a harder follow-up challenge before a
   * token is minted — distinct from RISK_BLOCKED, which is a hard deny. */
  | "CHALLENGE_REQUIRED";

export interface VerifyResult {
  success: boolean;
  outcome: VerificationOutcome;
  riskLevel: RiskLevel;
  challengeId?: string;
  action?: string;
  siteId?: string;
  /** Present only when a harder challenge is required instead of a hard
   * pass/fail (adaptive escalation, docs/ARCHITECTURE.md §Risk Engine). */
  nextChallenge?: PublicChallenge;
}
