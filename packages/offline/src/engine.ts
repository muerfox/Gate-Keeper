import {
  JwsSigner,
  loadSigningKeyMaterial,
  generateHmacKeyMaterial,
  randomNonce,
  InvalidSignatureError,
  TokenExpiredError,
} from "@gatekeeper/crypto";
import {
  issueChallenge,
  verifyEnvelope,
  checkAnswer,
  selectChallengeType,
  EnvelopeMismatchError,
  type ChallengeRecord,
} from "@gatekeeper/challenges";
import { assessRisk } from "@gatekeeper/risk-engine";
import type { ChallengeType, InteractionEvent, PublicChallenge, RiskLevel, VerificationOutcome } from "@gatekeeper/shared";
import { DEFAULT_CHALLENGE_TTL_SECONDS, DEFAULT_TOKEN_TTL_SECONDS } from "@gatekeeper/shared";
import { MemoryChallengeStore, MemoryCounter, MemoryReplayStore } from "./memory-store.js";

export interface OfflineGateKeeperOptions {
  /**
   * Base64url signing key material — the output of
   * `generateHmacKeyMaterial()` from @gatekeeper/crypto. REQUIRED for any
   * deployment that must survive a process restart with previously issued
   * tokens still verifiable; persist it in your own secret storage. If
   * omitted, an ephemeral key is generated at startup and everything
   * issued before a restart becomes unverifiable after one — acceptable
   * for a short-lived embedded/CLI use case, not for a long-running
   * service.
   */
  signingKey?: string;
  /** A stable identifier for this deployment, bound into every challenge/
   * token exactly like `siteId` in online mode. Defaults to "offline". */
  siteId?: string;
  challengeTtlSeconds?: number;
  tokenTtlSeconds?: number;
  allowComputational?: boolean;
}

export interface OfflineVerifyInput {
  challengeId: string;
  action: string;
  signedEnvelope: string;
  answer: unknown;
  events?: InteractionEvent[];
}

export interface OfflineVerifyResult {
  success: boolean;
  outcome: VerificationOutcome;
  riskLevel: RiskLevel;
  token?: string;
}

export interface OfflineTokenVerifyResult {
  success: boolean;
  outcome: VerificationOutcome;
}

const TOKEN_SUBJECT = "gk_token";
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const VELOCITY_WINDOW_MS = 60 * 1000;

/**
 * Local, no-network issuance and verification of Gate Keeper challenges and
 * tokens — see docs/OFFLINE_MODE.md before using this in place of the
 * hosted/online API. It reuses the exact same cryptographic primitives and
 * challenge engine as online mode (@gatekeeper/crypto, @gatekeeper/
 * challenges, @gatekeeper/risk-engine); what's different is where state
 * lives (this process's memory instead of Redis/Postgres) and what's
 * MISSING relative to online mode:
 *
 *   - No distributed replay protection (single-process only, see
 *     memory-store.ts).
 *   - No IP/domain reputation, no cross-customer abuse intelligence.
 *   - No persistent audit log, dashboard, or analytics unless you build
 *     your own on top of this package's return values.
 *   - No admin plane / key rotation UI — the signing key is whatever you
 *     pass in or generate and store yourself.
 *
 * This is NOT a security-equivalent drop-in replacement for online mode.
 * It exists for intranets, air-gapped systems, and self-hosted
 * deployments where the alternative is no bot mitigation at all.
 */
export async function createOfflineGateKeeper(options: OfflineGateKeeperOptions = {}) {
  const keys = await loadSigningKeyMaterial(options.signingKey ?? generateHmacKeyMaterial());
  const signer = new JwsSigner(keys);
  const siteId = options.siteId ?? "offline";
  const challengeTtlSeconds = options.challengeTtlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS;
  const tokenTtlSeconds = options.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;

  const challengeStore = new MemoryChallengeStore();
  const tokenReplayStore = new MemoryReplayStore();
  const velocityCounter = new MemoryCounter();
  const failureCounter = new MemoryCounter();

  async function issue(action: string, opts: { type?: ChallengeType; difficulty?: number; accessible?: boolean } = {}): Promise<PublicChallenge> {
    const type = opts.type ?? selectChallengeType({ requireAccessible: opts.accessible, allowComputational: options.allowComputational ?? true });
    const difficulty = opts.difficulty ?? 1;
    const { record, publicChallenge } = await issueChallenge(signer, { siteId, action, type, difficulty, ttlSeconds: challengeTtlSeconds });
    challengeStore.put(record);
    return publicChallenge;
  }

  async function verify(input: OfflineVerifyInput): Promise<OfflineVerifyResult> {
    const record = challengeStore.takeOnce(input.challengeId);
    if (!record) {
      return { success: false, outcome: "ALREADY_CONSUMED", riskLevel: "CRITICAL" };
    }

    let envelope: { nonce: string };
    try {
      envelope = await verifyEnvelope(signer, input.signedEnvelope, { siteId, action: input.action, challengeId: input.challengeId });
      if (envelope.nonce !== record.nonce) throw new EnvelopeMismatchError("nonce");
    } catch (err) {
      const outcome: VerificationOutcome =
        err instanceof TokenExpiredError ? "EXPIRED" : err instanceof EnvelopeMismatchError ? mismatchOutcome(err) : "INVALID_SIGNATURE";
      return { success: false, outcome, riskLevel: "HIGH" };
    }

    const answerCorrect = checkAnswer(record, input.answer);
    const key = `${siteId}:${input.action}`;
    const recentRequestVelocity = velocityCounter.recordAndCount(key, VELOCITY_WINDOW_MS);
    const recentFailureCount = failureCounter.peek(key, FAILURE_WINDOW_MS);

    const assessment = assessRisk({
      events: input.events ?? [],
      serverObservedSolveMs: Date.now() - record.issuedAt,
      minPlausibleSolveMs: record.minPlausibleSolveMs,
      recentRequestVelocity,
      recentFailureCount,
      replayDetected: false,
    });

    if (!answerCorrect) {
      failureCounter.recordAndCount(key, FAILURE_WINDOW_MS);
      return { success: false, outcome: "FAILED_ANSWER", riskLevel: assessment.level };
    }

    if (assessment.level === "CRITICAL") {
      return { success: false, outcome: "RISK_BLOCKED", riskLevel: assessment.level };
    }

    const jti = randomNonce();
    const token = await signer.sign(
      { sid: siteId, act: input.action, cid: input.challengeId, risk: assessment.level, env: "offline" },
      { subject: TOKEN_SUBJECT, jti, expiresInSeconds: tokenTtlSeconds },
    );

    return { success: true, outcome: "SUCCESS", riskLevel: assessment.level, token };
  }

  async function verifyToken(token: string, action: string): Promise<OfflineTokenVerifyResult> {
    let payload;
    try {
      payload = await signer.verify(token, TOKEN_SUBJECT);
    } catch (err) {
      return { success: false, outcome: err instanceof TokenExpiredError ? "EXPIRED" : "INVALID_SIGNATURE" };
    }

    if (payload.sid !== siteId) return { success: false, outcome: "SITE_MISMATCH" };
    if (payload.act !== action) return { success: false, outcome: "ACTION_MISMATCH" };

    const remainingTtl = Math.max(Math.ceil((Number(payload.exp) * 1000 - Date.now()) / 1000), 1);
    const consumed = tokenReplayStore.consume(String(payload.jti), remainingTtl);
    if (!consumed) return { success: false, outcome: "ALREADY_CONSUMED" };

    return { success: true, outcome: "SUCCESS" };
  }

  return { issue, verify, verifyToken };
}

function mismatchOutcome(err: EnvelopeMismatchError): VerificationOutcome {
  if (err.message.endsWith("siteId")) return "SITE_MISMATCH";
  if (err.message.endsWith("action")) return "ACTION_MISMATCH";
  return "INVALID_SIGNATURE";
}

export type { ChallengeRecord };
