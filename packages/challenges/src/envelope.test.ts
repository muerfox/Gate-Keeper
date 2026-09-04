import { describe, expect, it } from "vitest";
import { generateHmacKeyMaterial, loadSigningKeyMaterial, JwsSigner } from "@gatekeeper/crypto";
import { issueChallenge, verifyEnvelope, checkAnswer, EnvelopeMismatchError } from "./envelope.js";
import { InvalidSignatureError } from "@gatekeeper/crypto";

async function makeSigner() {
  const keys = await loadSigningKeyMaterial(generateHmacKeyMaterial());
  return new JwsSigner(keys);
}

describe("issueChallenge / verifyEnvelope", () => {
  it("issues a challenge whose envelope verifies for the correct site/action/id", async () => {
    const signer = await makeSigner();
    const { record, publicChallenge } = await issueChallenge(signer, {
      siteId: "site_a",
      action: "signup",
      type: "pattern_recognition",
      difficulty: 2,
      ttlSeconds: 90,
    });

    const result = await verifyEnvelope(signer, publicChallenge.signedEnvelope, {
      siteId: "site_a",
      action: "signup",
      challengeId: publicChallenge.id,
    });

    expect(result.nonce).toBe(record.nonce);
    expect(publicChallenge.payload).not.toHaveProperty("expectedAnswer");
  });

  it("rejects an envelope replayed against a different site (cross-site token reuse)", async () => {
    const signer = await makeSigner();
    const { publicChallenge } = await issueChallenge(signer, {
      siteId: "site_a",
      action: "signup",
      type: "pattern_recognition",
      difficulty: 1,
      ttlSeconds: 90,
    });

    await expect(
      verifyEnvelope(signer, publicChallenge.signedEnvelope, {
        siteId: "site_b",
        action: "signup",
        challengeId: publicChallenge.id,
      }),
    ).rejects.toBeInstanceOf(EnvelopeMismatchError);
  });

  it("rejects an envelope replayed against a different action (cross-action token reuse)", async () => {
    const signer = await makeSigner();
    const { publicChallenge } = await issueChallenge(signer, {
      siteId: "site_a",
      action: "login",
      type: "pattern_recognition",
      difficulty: 1,
      ttlSeconds: 90,
    });

    await expect(
      verifyEnvelope(signer, publicChallenge.signedEnvelope, {
        siteId: "site_a",
        action: "checkout",
        challengeId: publicChallenge.id,
      }),
    ).rejects.toBeInstanceOf(EnvelopeMismatchError);
  });

  it("rejects an envelope whose challengeId does not match", async () => {
    const signer = await makeSigner();
    const { publicChallenge } = await issueChallenge(signer, {
      siteId: "site_a",
      action: "signup",
      type: "pattern_recognition",
      difficulty: 1,
      ttlSeconds: 90,
    });

    await expect(
      verifyEnvelope(signer, publicChallenge.signedEnvelope, {
        siteId: "site_a",
        action: "signup",
        challengeId: "some-other-id",
      }),
    ).rejects.toBeInstanceOf(EnvelopeMismatchError);
  });

  it("rejects a forged envelope signed with a different key", async () => {
    const signer = await makeSigner();
    const attackerSigner = await makeSigner();
    const { publicChallenge } = await issueChallenge(attackerSigner, {
      siteId: "site_a",
      action: "signup",
      type: "pattern_recognition",
      difficulty: 1,
      ttlSeconds: 90,
    });

    await expect(
      verifyEnvelope(signer, publicChallenge.signedEnvelope, {
        siteId: "site_a",
        action: "signup",
        challengeId: publicChallenge.id,
      }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("checkAnswer accepts the correct answer and rejects an incorrect one", async () => {
    const signer = await makeSigner();
    const { record } = await issueChallenge(signer, {
      siteId: "site_a",
      action: "signup",
      type: "pattern_recognition",
      difficulty: 1,
      ttlSeconds: 90,
    });

    // pattern_recognition's expectedAnswer is a bare tile id string (see
    // generators/pattern-recognition.ts), not JSON — verified directly.
    expect(checkAnswer(record, record.expectedAnswer)).toBe(true);
    expect(checkAnswer(record, "definitely-not-the-answer")).toBe(false);
  });
});
