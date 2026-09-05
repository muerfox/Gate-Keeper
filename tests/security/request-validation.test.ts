/**
 * Adversarial suite: malformed, oversized, and schema-violating requests
 * against the live API — an attacker scripting raw HTTP directly, skipping
 * the widget entirely (docs/THREAT_MODEL.md §4.10, §4.11).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../helpers/app.js";
import { createTestSite } from "../helpers/fixtures.js";
import { MAX_REQUEST_BODY_BYTES } from "@gatekeeper/shared";

describe("request validation under adversarial input", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("rejects a request body larger than the configured limit", async () => {
    const { siteKey } = await createTestSite(t.db);
    const oversizedAction = "a".repeat(MAX_REQUEST_BODY_BYTES + 1024);

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/challenge",
      payload: `{"siteKey":"${siteKey}","action":"${oversizedAction}"}`,
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(413);
  });

  it("rejects malformed JSON", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/challenge",
      payload: "{not valid json",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects wrong types for expected string fields", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/v1/challenge", payload: { siteKey: 12345, action: { nested: true } } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an action string that violates the allowed character pattern", async () => {
    const { siteKey } = await createTestSite(t.db);
    const res = await t.app.inject({ method: "POST", url: "/api/v1/challenge", payload: { siteKey, action: "signup<script>alert(1)</script>" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a request with unknown/extra top-level fields", async () => {
    const { siteKey } = await createTestSite(t.db);
    const res = await t.app.inject({ method: "POST", url: "/api/v1/challenge", payload: { siteKey, action: "signup", isAdmin: true } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an interaction-events array beyond the bounded maximum", async () => {
    const { siteKey } = await createTestSite(t.db);
    // Just over MAX_INTERACTION_EVENTS (500), but still small enough in
    // bytes that this exercises the array-length schema check specifically
    // rather than the overall request body size limit (covered above).
    const events = Array.from({ length: 600 }, (_, i) => ({ t: i, type: "pointermove" as const }));
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: { siteKey, action: "signup", challengeId: "x", signedEnvelope: "x.x.x", answer: "x", events },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing required field", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/v1/challenge", payload: { action: "signup" } });
    expect(res.statusCode).toBe(400);
  });

  it("does not crash on deeply nested / prototype-pollution-shaped payloads", async () => {
    const { siteKey } = await createTestSite(t.db);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      payload: {
        siteKey,
        action: "signup",
        challengeId: "x",
        signedEnvelope: "x.x.x",
        answer: { __proto__: { polluted: true }, constructor: { prototype: { polluted: true } } },
        events: [],
      },
    });
    // Must not succeed and must not throw a 500 — the answer is opaque
    // `unknown` to the schema and only ever compared, never merged/assigned
    // onto a shared object.
    expect(res.statusCode).toBeLessThan(500);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
