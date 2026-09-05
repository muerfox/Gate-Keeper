/**
 * Adversarial suite: token/challenge forgery, tampering, and replay at the
 * live HTTP API (not just the underlying package unit tests) — modeling an
 * attacker who talks to /api/v1/* directly, per docs/THREAT_MODEL.md's
 * assumed capabilities. Each test assumes the attacker has full access to
 * every value the widget would normally send and can modify it freely.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueChallenge } from "@gatekeeper/challenges";
import { DEFAULT_CHALLENGE_TTL_SECONDS } from "@gatekeeper/shared";
import { buildTestApp, type TestApp } from "../helpers/app.js";
import { createTestSite } from "../helpers/fixtures.js";

async function issueKnown(t: TestApp, siteId: string, action: string, ttlSeconds = DEFAULT_CHALLENGE_TTL_SECONDS) {
  const { record, publicChallenge } = await issueChallenge(t.ctx.signer, {
    siteId,
    action,
    type: "pattern_recognition",
    difficulty: 1,
    ttlSeconds,
  });
  await t.ctx.challengeStore.put(record);
  return { record, publicChallenge };
}

describe("token/challenge integrity under adversarial tampering", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("rejects a completely forged envelope (attacker never received a real challenge)", async () => {
    const { siteKey } = await createTestSite(t.db);
    const forgedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "gk_challenge", cid: "fake", sid: "fake", act: "signup" })).toString("base64url");
    const forgedEnvelope = `${forgedHeader}.${forgedPayload}.forged-signature`;

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "signup", challengeId: "fake", signedEnvelope: forgedEnvelope, answer: "anything", events: [] },
    });
    expect(res.json().success).toBe(false);
  });

  it("rejects an envelope with the 'alg' header switched to 'none' (classic JWT bypass)", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnown(t, site.id, "signup");

    const [, payload] = publicChallenge.signedEnvelope.split(".");
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const forged = `${noneHeader}.${payload}.`; // no signature at all

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: forged, answer: record.expectedAnswer, events: [] },
    });
    expect(res.json().success).toBe(false);
  });

  it("rejects an envelope with a modified difficulty/type claim (payload tampering)", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnown(t, site.id, "signup");

    const [header, , signature] = publicChallenge.signedEnvelope.split(".");
    const decoded = JSON.parse(Buffer.from(publicChallenge.signedEnvelope.split(".")[1]!, "base64url").toString());
    decoded.dif = 5; // attacker tries to claim a harder/different difficulty was issued
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: tampered, answer: record.expectedAnswer, events: [] },
    });
    expect(res.json().success).toBe(false);
  });

  it("rejects an expired challenge even with the correct answer", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnown(t, site.id, "signup", 1);
    await new Promise((r) => setTimeout(r, 1100));

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: record.expectedAnswer, events: [] },
    });
    expect(res.json().success).toBe(false);
  });

  it("rejects a token replayed after the customer backend already consumed it", async () => {
    const { site, siteKey, secretKey } = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnown(t, site.id, "signup");

    const verify = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: record.expectedAnswer, events: [] },
    });
    const token = verify.json().token as string;

    const spend1 = await t.app.inject({ method: "POST", url: "/api/v1/verify", headers: { authorization: `Bearer ${secretKey}` }, payload: { token, action: "signup" } });
    expect(spend1.json().success).toBe(true);

    // Attacker captured the same token (e.g. via a logging leak or a
    // replayed HTTP request) and tries to spend it again.
    const spend2 = await t.app.inject({ method: "POST", url: "/api/v1/verify", headers: { authorization: `Bearer ${secretKey}` }, payload: { token, action: "signup" } });
    expect(spend2.json().success).toBe(false);
    expect(spend2.json().outcome).toBe("ALREADY_CONSUMED");
  });

  it("rejects a token minted for site A when spent against site B's secret key (cross-tenant token theft)", async () => {
    const a = await createTestSite(t.db);
    const b = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnown(t, a.site.id, "signup");

    const verify = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey: a.siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: record.expectedAnswer, events: [] },
    });
    const token = verify.json().token as string;

    const stolen = await t.app.inject({ method: "POST", url: "/api/v1/verify", headers: { authorization: `Bearer ${b.secretKey}` }, payload: { token, action: "signup" } });
    expect(stolen.json().success).toBe(false);
    expect(stolen.json().outcome).toBe("SITE_MISMATCH");
  });

  it("rejects a token minted for 'signup' when spent against a more sensitive action ('checkout')", async () => {
    const { site, siteKey, secretKey } = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnown(t, site.id, "signup");

    const verify = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: record.expectedAnswer, events: [] },
    });
    const token = verify.json().token as string;

    const escalated = await t.app.inject({ method: "POST", url: "/api/v1/verify", headers: { authorization: `Bearer ${secretKey}` }, payload: { token, action: "checkout" } });
    expect(escalated.json().success).toBe(false);
    expect(escalated.json().outcome).toBe("ACTION_MISMATCH");
  });

  it("rejects brute-force guessing against a single challenge (single-use, not retryable)", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const { publicChallenge } = await issueKnown(t, site.id, "signup");

    // First guess (wrong) consumes the challenge outright.
    const guess1 = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: "guess-1", events: [] },
    });
    expect(guess1.json().outcome).toBe("FAILED_ANSWER");

    // A second guess against the SAME challenge id can never succeed, no
    // matter how many further attempts are made — this is what bounds
    // brute-force search against one issued instance.
    for (const guess of ["guess-2", "guess-3", "t0"]) {
      const res = await t.app.inject({
        method: "POST",
        url: "/api/v1/verify",
        payload: { siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: guess, events: [] },
      });
      expect(res.json().outcome).toBe("ALREADY_CONSUMED");
    }
  });

  it("cannot influence the outcome by injecting extra fields into the verify request (e.g. a forged riskLevel or success flag)", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnown(t, site.id, "signup");

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: {
        siteKey,
        action: "signup",
        challengeId: publicChallenge.id,
        signedEnvelope: publicChallenge.signedEnvelope,
        answer: record.expectedAnswer,
        events: [],
        // Attacker-injected fields that don't exist in the schema:
        riskLevel: "LOW",
        success: true,
        token: "attacker-supplied-token",
      },
    });
    // The strict Zod schema rejects unknown fields outright.
    expect(res.statusCode).toBe(400);
  });
});
