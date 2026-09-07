import { JwsSigner, randomId, randomNonce, type KeyMaterial } from "@gatekeeper/crypto";
import type { ChallengeType, PublicChallenge } from "@gatekeeper/shared";
import { generateChallenge, verifyChallengeAnswer } from "./engine.js";

const CHALLENGE_SUBJECT = "gk_challenge";

/** Server-only record kept alongside the public envelope (Redis/DB, short
 * TTL matching the challenge expiry) — the client never sees
 * `expectedAnswer`. This is stored as plaintext (not a one-way hash)
 * deliberately: several generators need the *actual* expected value to run
 * tolerant, type-specific comparisons (e.g. rotation angle within a
 * tolerance, or order-independent set equality) that a hash cannot support.
 * Confidentiality of this record instead rests on it never leaving the
 * server's Redis/DB trust boundary — the same boundary that already holds
 * the signing key. */
export interface ChallengeRecord {
  id: string;
  nonce: string;
  type: ChallengeType;
  difficulty: number;
  siteId: string;
  action: string;
  issuedAt: number;
  expiresAt: number;
  expectedAnswer: string;
  minPlausibleSolveMs: number;
}

export interface IssueChallengeInput {
  siteId: string;
  action: string;
  type: ChallengeType;
  difficulty: number;
  ttlSeconds: number;
}

export interface IssuedChallenge {
  record: ChallengeRecord;
  publicChallenge: PublicChallenge;
}

/** Issues a new challenge: generates type-specific content, hashes the
 * expected answer, and produces a signed envelope binding id/nonce/site/
 * action/expiry so the API can verify authenticity without a store lookup
 * (the store lookup is still required for one-time-use — see
 * docs/ARCHITECTURE.md §Replay Protection). */
export async function issueChallenge(signer: JwsSigner, input: IssueChallengeInput): Promise<IssuedChallenge> {
  const id = randomId();
  const nonce = randomNonce();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + input.ttlSeconds * 1000;

  const generated = generateChallenge(input.type, input.difficulty);

  const record: ChallengeRecord = {
    id,
    nonce,
    type: input.type,
    difficulty: input.difficulty,
    siteId: input.siteId,
    action: input.action,
    issuedAt,
    expiresAt,
    expectedAnswer: generated.expectedAnswer,
    minPlausibleSolveMs: generated.minPlausibleSolveMs,
  };

  const signedEnvelope = await signer.sign(
    {
      cid: id,
      sid: input.siteId,
      act: input.action,
      typ: input.type,
      dif: input.difficulty,
    },
    { subject: CHALLENGE_SUBJECT, jti: nonce, expiresInSeconds: input.ttlSeconds },
  );

  return {
    record,
    publicChallenge: {
      id,
      type: input.type,
      difficulty: input.difficulty,
      siteId: input.siteId,
      action: input.action,
      issuedAt,
      expiresAt,
      payload: generated.payload,
      signedEnvelope,
    },
  };
}

export class EnvelopeMismatchError extends Error {
  constructor(field: string) {
    super(`envelope_mismatch:${field}`);
  }
}

/** Verifies the signed envelope's authenticity and that its claims match
 * what the caller expects (site key resolved to siteId, declared action,
 * and the challengeId the client says it's answering). Throws on any
 * mismatch — callers must not proceed to answer-checking otherwise. */
export async function verifyEnvelope(
  signer: JwsSigner,
  signedEnvelope: string,
  expected: { siteId: string; action: string; challengeId: string },
): Promise<{ nonce: string; type: ChallengeType; difficulty: number }> {
  const payload = await signer.verify(signedEnvelope, CHALLENGE_SUBJECT);

  if (payload.cid !== expected.challengeId) throw new EnvelopeMismatchError("challengeId");
  if (payload.sid !== expected.siteId) throw new EnvelopeMismatchError("siteId");
  if (payload.act !== expected.action) throw new EnvelopeMismatchError("action");

  return {
    nonce: String(payload.jti),
    type: payload.typ as ChallengeType,
    difficulty: Number(payload.dif),
  };
}

export function checkAnswer(record: Pick<ChallengeRecord, "type" | "difficulty" | "expectedAnswer">, answer: unknown): boolean {
  return verifyChallengeAnswer(record.type, answer, record.expectedAnswer, record.difficulty);
}

export type { KeyMaterial };
