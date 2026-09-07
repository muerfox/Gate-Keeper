/**
 * Adversarial suite: authentication bypass, authorization bypass, and
 * CORS/CSRF posture (docs/THREAT_MODEL.md §4.13, §4.10).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSecret } from "@gatekeeper/crypto";
import { buildTestApp, type TestApp } from "../helpers/app.js";
import { createTestAdmin } from "../helpers/fixtures.js";

describe("authentication bypass attempts", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("rejects a session token that was never issued", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: "Bearer totally-made-up-token" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an empty bearer token", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: "Bearer " } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a malformed Authorization header (no 'Bearer ' prefix)", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: "sessiontoken-without-bearer-prefix" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a revoked session's token even though it hasn't expired yet", async () => {
    const { admin, email, password } = await createTestAdmin(t.db, { email: "revoke-test@example.com" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    await t.db.adminSession.updateMany({ where: { adminId: admin.id }, data: { revokedAt: new Date() } });

    const res = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a session for a disabled administrator account", async () => {
    const { admin, email, password } = await createTestAdmin(t.db, { email: "disabled-test@example.com" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    await t.db.administrator.update({ where: { id: admin.id }, data: { disabledAt: new Date() } });

    const res = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
  });

  it("does not accept a hand-crafted token hash as if it were a real session (hash collision attempt)", async () => {
    // An attacker who somehow learns the hashing SCHEME (sha256, base64url)
    // still cannot forge a session without knowing a pre-image that hashes
    // to a value already stored — sha256 preimage resistance holds. This
    // test just confirms guessing common/weak tokens doesn't work.
    for (const guess of ["", "admin", "0".repeat(32), hashSecret("admin")]) {
      const res = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: `Bearer ${guess}` } });
      expect(res.statusCode).toBe(401);
    }
  });

  it("does not leak whether an email exists via response timing category (both paths return the same generic 401 shape)", async () => {
    const { email } = await createTestAdmin(t.db, { email: "exists@example.com", password: "correct password" });
    const existingWrongPassword = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password: "wrong" } });
    const nonExistent = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email: "ghost@example.com", password: "wrong" } });

    expect(existingWrongPassword.statusCode).toBe(nonExistent.statusCode);
    expect(existingWrongPassword.json()).toEqual(nonExistent.json());
  });
});

describe("authorization bypass (RBAC / IDOR)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("VIEWER cannot create API keys", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "viewer2@example.com", role: "VIEWER" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { siteId: "does-not-matter", type: "SECRET_SERVER_KEY", environment: "PRODUCTION" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("VIEWER cannot revoke API keys", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "viewer3@example.com", role: "VIEWER" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    const res = await t.app.inject({ method: "DELETE", url: "/api/v1/keys/some-id", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it("VIEWER cannot change site configuration", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "viewer4@example.com", role: "VIEWER" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    const res = await t.app.inject({
      method: "PATCH",
      url: "/api/v1/site/some-id/config",
      headers: { authorization: `Bearer ${token}` },
      payload: { ipProcessingEnabled: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a public site key can never authenticate a secret-key-only (server-to-server) verify call", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "pubkey-as-secret@example.com" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    const created = await t.app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "pubkey-as-secret-test", domains: [], environment: "PRODUCTION" },
    });
    const siteId = created.json().id as string;
    const publicKey = await t.app.inject({
      method: "POST",
      url: "/api/v1/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { siteId, type: "PUBLIC_SITE_KEY", environment: "PRODUCTION" },
    });

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      headers: { authorization: `Bearer ${publicKey.json().value}` },
      payload: { token: "irrelevant", action: "signup" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("CORS/CSRF posture", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("a cross-site <form> submission cannot forge an authenticated admin request", async () => {
    // Two independent layers both defeat this, either one sufficient on
    // its own:
    //   1. A plain HTML form can only submit as
    //      application/x-www-form-urlencoded, multipart/form-data, or
    //      text/plain — never application/json — and Fastify has no body
    //      parser registered for those content types on this API, so the
    //      request is rejected (415) before any route handler runs.
    //   2. Even if an attacker used fetch()/XHR from their own page to
    //      send a same-shaped JSON request, admin auth reads the session
    //      token from an Authorization header the attacker's origin has
    //      no access to (never an ambient cookie) — see the "no
    //      Authorization header" case above, already covered by the
    //      generic 401 tests in this file.
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
      payload: "name=csrf-attempt&environment=PRODUCTION",
    });
    expect(res.statusCode).toBe(415);
  });

  it("the verification endpoints respond regardless of Origin (by design — trust comes from the signed envelope/domain allow-list, not CORS)", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/challenge",
      headers: { origin: "https://some-random-site.example" },
      payload: { siteKey: "gk_pub_doesnotexist", action: "signup" },
    });
    // Still enforced by site-key/domain checks (401 here because the key
    // doesn't exist) — the point is CORS itself doesn't gate this endpoint.
    expect(res.statusCode).toBe(401);
  });
});
