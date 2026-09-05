import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../helpers/app.js";
import { createTestSite } from "../helpers/fixtures.js";

describe("POST /api/v1/challenge", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("issues a challenge for a valid public site key", async () => {
    const { siteKey } = await createTestSite(t.db);
    const res = await t.app.inject({ method: "POST", url: "/api/v1/challenge", payload: { siteKey, action: "signup" } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("signedEnvelope");
    expect(body).toHaveProperty("payload");
    // The answer must never leak into the client-visible payload.
    expect(JSON.stringify(body)).not.toContain("expectedAnswer");
  });

  it("rejects an unknown site key", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/v1/challenge", payload: { siteKey: "gk_pub_doesnotexist", action: "signup" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a malformed request body", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/v1/challenge", payload: { siteKey: "x", action: "signup", extraField: "nope" } });
    expect(res.statusCode).toBe(400);
  });

  it("enforces domain restriction when domains are registered", async () => {
    const { siteKey } = await createTestSite(t.db, { domains: ["example.com"] });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/challenge",
      payload: { siteKey, action: "signup" },
      headers: { origin: "https://evil.com" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows a registered domain", async () => {
    const { siteKey } = await createTestSite(t.db, { domains: ["example.com"] });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/challenge",
      payload: { siteKey, action: "signup" },
      headers: { origin: "https://example.com" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("issues an accessible-eligible challenge when requested", async () => {
    // "Accessible" means the type requires no vision/hearing/fine-motor/
    // reaction-speed (see packages/challenges' `accessible` flag) — that
    // pool includes accessible_alternative but also the background
    // computational types, which impose zero interactive burden at all.
    const { siteKey } = await createTestSite(t.db);
    const res = await t.app.inject({ method: "POST", url: "/api/v1/challenge", payload: { siteKey, action: "signup", accessible: true } });
    expect(res.statusCode).toBe(200);
    expect(["accessible_alternative", "dynamic_interaction", "proof_of_work", "cryptographic_proof"]).toContain(res.json().type);
  });
});
