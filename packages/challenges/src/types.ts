import type { ChallengeType } from "@gatekeeper/shared";

/** A generator produces the client-visible payload and the server-only
 * expected answer(s) for one challenge instance. Generators must never leak
 * the answer into `payload`. */
export interface GeneratedChallenge {
  type: ChallengeType;
  /** Sent to the client verbatim inside the signed envelope. */
  payload: Record<string, unknown>;
  /** Server-only. Verifiers receive this alongside the client's submitted
   * answer — never serialized into the signed envelope or any client
   * response. */
  expectedAnswer: string;
  /** Suggested minimum human solve time in ms, used by the risk engine as a
   * weak corroborating signal (docs/THREAT_MODEL.md §4.9) — never a hard
   * pass/fail gate on its own. */
  minPlausibleSolveMs: number;
}

export interface ChallengeGenerator {
  type: ChallengeType;
  /** 1 (easiest) .. 5 (hardest). Generators should scale payload complexity
   * with difficulty, not just cosmetic appearance. */
  generate(difficulty: number): GeneratedChallenge;
  /** Validates a client-submitted answer against the expected answer.
   * Kept separate from generic string equality so per-type answers can
   * have their own tolerant comparison (e.g. small pixel tolerance for
   * rotation angles). */
  verify(answer: unknown, expectedAnswer: string, difficulty: number): boolean;
  /** True if this challenge type can be completed without vision, hearing,
   * fine motor pointer control, or fast reaction time (WCAG — see
   * docs/ACCESSIBILITY.md). Used to build the accessible-alternative set. */
  accessible: boolean;
}
