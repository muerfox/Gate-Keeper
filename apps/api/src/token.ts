import { JwsSigner, InvalidSignatureError, TokenExpiredError, randomNonce } from "@gatekeeper/crypto";
import type { ReplayStore } from "@gatekeeper/rate-limit";
import type { RiskLevel, VerificationOutcome } from "@gatekeeper/shared";

export const TOKEN_SUBJECT = "gk_token";

export interface IssueTokenInput {
  siteId: string;
  action: string;
  challengeId: string;
  riskLevel: RiskLevel;
  environment: "DEVELOPMENT" | "PRODUCTION";
  ttlSeconds: number;
}

export async function issueVerificationToken(signer: JwsSigner, input: IssueTokenInput): Promise<string> {
  const nonce = randomNonce();
  // Namespacing the jti with siteId/action lets the Postgres fallback
  // replay store (token-store.ts) recover those fields from the key alone
  // if it ever needs to record a consumption without a live Redis lookup.
  const jti = `${input.siteId}:${input.action}:${nonce}`;
  return signer.sign(
    { sid: input.siteId, act: input.action, cid: input.challengeId, risk: input.riskLevel, env: input.environment },
    { subject: TOKEN_SUBJECT, jti, expiresInSeconds: input.ttlSeconds },
  );
}

export interface TokenVerificationResult {
  outcome: VerificationOutcome;
  success: boolean;
  siteId?: string;
  action?: string;
  challengeId?: string;
  riskLevel?: RiskLevel;
}

/**
 * Verifies signature + expiry + action binding, then atomically consumes
 * the token. This is the ONLY function that should ever be called to
 * "spend" a verification token — see docs/ARCHITECTURE.md's request-flow
 * diagram: the customer's backend calls this (via the server SDK), which is
 * what closes the loop against token replay/farming.
 */
export async function verifyAndConsumeToken(
  signer: JwsSigner,
  replayStore: ReplayStore,
  token: string,
  expectedAction: string,
  expectedSiteId?: string,
): Promise<TokenVerificationResult> {
  let payload;
  try {
    payload = await signer.verify(token, TOKEN_SUBJECT);
  } catch (err) {
    if (err instanceof TokenExpiredError) return { outcome: "EXPIRED", success: false };
    if (err instanceof InvalidSignatureError) return { outcome: "INVALID_SIGNATURE", success: false };
    throw err;
  }

  const siteId = String(payload.sid);
  const action = String(payload.act);
  const challengeId = String(payload.cid);
  const riskLevel = payload.risk as RiskLevel;

  if (expectedSiteId && siteId !== expectedSiteId) {
    return { outcome: "SITE_MISMATCH", success: false, siteId, action, challengeId, riskLevel };
  }
  if (action !== expectedAction) {
    return { outcome: "ACTION_MISMATCH", success: false, siteId, action, challengeId, riskLevel };
  }

  const jti = String(payload.jti);
  const remainingTtl = Math.max(Math.ceil((Number(payload.exp) * 1000 - Date.now()) / 1000), 1);
  const consumed = await replayStore.consume(jti, remainingTtl);
  if (!consumed) {
    return { outcome: "ALREADY_CONSUMED", success: false, siteId, action, challengeId, riskLevel };
  }

  return { outcome: "SUCCESS", success: true, siteId, action, challengeId, riskLevel };
}
