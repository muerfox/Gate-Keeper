import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueChallenge } from "@gatekeeper/challenges";
import { DEFAULT_CHALLENGE_TTL_SECONDS } from "@gatekeeper/shared";
import { buildTestApp, type TestApp } from "../helpers/app.js";
import { createTestSite } from "../helpers/fixtures.js";

/** Issues a `pattern_recognition` challenge directly through the same
 * @gatekeeper/challenges + ChallengeStore path the HTTP /challenge route
 * uses internally, so this test can know the correct answer deterministically
 * (pattern_recognition's answer is a bare tile id) while still exercising
 * the real /verify route end-to-end. */
async function issueKnownChallenge(t: TestApp, siteId: string, action: string) {
  const { record, publicChallenge } = await issueChallenge(t.ctx.signer, {
    siteId,
    action,
    type: "pattern_recognition",
    difficulty: 1,
    ttlSeconds: DEFAULT_CHALLENGE_TTL_SECONDS,
  });
  await t.ctx.challengeStore.put(record);
  return { record, publicChallenge };
}

describe("POST /api/v1/verify (client flow)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("mints a token for a correctly solved challenge", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnownChallenge(t, site.id, "signup");

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
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.outcome).toBe("SUCCESS");
    expect(typeof body.token).toBe("string");
  });

  it("fails and does not mint a token for a wrong answer", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const { publicChallenge } = await issueKnownChallenge(t, site.id, "signup");

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: "wrong", events: [] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.outcome).toBe("FAILED_ANSWER");
    expect(body.token).toBeUndefined();
  });

  it("rejects a second verify attempt against the same challenge (single-use)", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnownChallenge(t, site.id, "signup");
    const payload = { siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: record.expectedAnswer, events: [] };

    const first = await t.app.inject({ method: "POST", url: "/api/v1/verify", payload });
    expect(first.json().success).toBe(true);

    const second = await t.app.inject({ method: "POST", url: "/api/v1/verify", payload });
    expect(second.json().success).toBe(false);
    expect(second.json().outcome).toBe("ALREADY_CONSUMED");
  });

  it("rejects a challenge answered for the wrong action", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnownChallenge(t, site.id, "signup");

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "checkout", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: record.expectedAnswer, events: [] },
    });

    // The envelope's signature won't validate for a different action, so
    // this must not be treated as a successful pass.
    expect(res.json().success).toBe(false);
  });

  it("rejects a token minted for one site when presented as another site's siteKey", async () => {
    const siteA = await createTestSite(t.db);
    const siteB = await createTestSite(t.db);
    const { record, publicChallenge } = await issueKnownChallenge(t, siteA.site.id, "signup");

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey: siteB.siteKey, action: "signup", challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: record.expectedAnswer, events: [] },
    });

    expect(res.json().success).toBe(false);
  });
});

describe("POST /api/v1/verify (server-to-server token consumption)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  async function solveAndGetToken(siteId: string, siteKey: string, action: string): Promise<string> {
    const { record, publicChallenge } = await issueKnownChallenge(t, siteId, action);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action, challengeId: publicChallenge.id, signedEnvelope: publicChallenge.signedEnvelope, answer: record.expectedAnswer, events: [] },
    });
    return res.json().token as string;
  }

  it("consumes a valid token exactly once via the secret-key flow", async () => {
    const { site, siteKey, secretKey } = await createTestSite(t.db);
    const token = await solveAndGetToken(site.id, siteKey, "signup");

    const first = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      headers: { authorization: `Bearer ${secretKey}` },
      payload: { token, action: "signup" },
    });
    expect(first.json().success).toBe(true);

    const second = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      headers: { authorization: `Bearer ${secretKey}` },
      payload: { token, action: "signup" },
    });
    expect(second.json().success).toBe(false);
    expect(second.json().outcome).toBe("ALREADY_CONSUMED");
  });

  it("rejects a token verified under the wrong action", async () => {
    const { site, siteKey, secretKey } = await createTestSite(t.db);
    const token = await solveAndGetToken(site.id, siteKey, "signup");

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      headers: { authorization: `Bearer ${secretKey}` },
      payload: { token, action: "checkout" },
    });
    expect(res.json().success).toBe(false);
    expect(res.json().outcome).toBe("ACTION_MISMATCH");
  });

  it("rejects a token presented to a different site's secret key", async () => {
    const siteA = await createTestSite(t.db);
    const siteB = await createTestSite(t.db);
    const token = await solveAndGetToken(siteA.site.id, siteA.siteKey, "signup");

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      headers: { authorization: `Bearer ${siteB.secretKey}` },
      payload: { token, action: "signup" },
    });
    expect(res.json().success).toBe(false);
    expect(res.json().outcome).toBe("SITE_MISMATCH");
  });

  it("rejects an invalid secret key", async () => {
    const { site, siteKey } = await createTestSite(t.db);
    const token = await solveAndGetToken(site.id, siteKey, "signup");

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      headers: { authorization: "Bearer gk_secret_not-a-real-key" },
      payload: { token, action: "signup" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("exactly one winner when the same token is submitted concurrently many times", async () => {
    const { site, siteKey, secretKey } = await createTestSite(t.db);
    const token = await solveAndGetToken(site.id, siteKey, "signup");

    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        t.app.inject({ method: "POST", url: "/api/v1/verify", headers: { authorization: `Bearer ${secretKey}` }, payload: { token, action: "signup" } }),
      ),
    );
    const successes = results.filter((r) => r.json().success);
    expect(successes).toHaveLength(1);
  });
});
