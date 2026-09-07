/**
 * Adversarial suite: secret/API-key exposure and information leakage
 * through error responses (docs/THREAT_MODEL.md §4.7, defense-in-depth
 * stance on not leaking implementation details).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../helpers/app.js";
import { createTestAdmin } from "../helpers/fixtures.js";

describe("secret exposure", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("never returns a secret server key's value again after creation", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "secret-exposure@example.com" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    const site = await t.app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "secret-exposure-site", domains: [], environment: "PRODUCTION" },
    });
    const siteId = site.json().id as string;

    const created = await t.app.inject({
      method: "POST",
      url: "/api/v1/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { siteId, type: "SECRET_SERVER_KEY", environment: "PRODUCTION" },
    });
    const secretValue = created.json().value as string;

    // Every other read surface for this site/key must never include the
    // raw secret — only its short prefix.
    const siteDetail = await t.app.inject({ method: "GET", url: `/api/v1/site?siteId=${siteId}`, headers: { authorization: `Bearer ${token}` } });
    const auditLogs = await t.app.inject({ method: "GET", url: "/api/v1/audit-logs", headers: { authorization: `Bearer ${token}` } });
    const events = await t.app.inject({ method: "GET", url: `/api/v1/events?siteId=${siteId}`, headers: { authorization: `Bearer ${token}` } });

    expect(JSON.stringify(siteDetail.json())).not.toContain(secretValue);
    expect(JSON.stringify(auditLogs.json())).not.toContain(secretValue);
    expect(JSON.stringify(events.json())).not.toContain(secretValue);
  });

  it("never stores a plaintext password (verified directly against the database)", async () => {
    const plaintextPassword = "a very specific and searchable password 123!";
    const { admin } = await createTestAdmin(t.db, { email: "plaintext-check@example.com", password: plaintextPassword });

    const row = await t.db.administrator.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row.passwordHash).not.toContain(plaintextPassword);
    expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("does not leak internal error details (stack traces, SQL, file paths) in error responses", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "error-leak@example.com" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    const res = await t.app.inject({
      method: "GET",
      url: "/api/v1/events?limit=not-a-number",
      headers: { authorization: `Bearer ${token}` },
    });
    const body = JSON.stringify(res.json());
    expect(body).not.toMatch(/at \w+\.\w+ \(/); // no stack trace frames
    expect(body.toLowerCase()).not.toContain("prisma");
    expect(body.toLowerCase()).not.toContain(".ts:");
  });

  it("does not echo the submitted secret key back in a verify error response", async () => {
    const fakeSecret = "gk_secret_definitely-not-real-00000000";
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      headers: { authorization: `Bearer ${fakeSecret}` },
      payload: { token: "x", action: "signup" },
    });
    expect(JSON.stringify(res.json())).not.toContain(fakeSecret);
  });

  it("rejects startup without a signing key rather than falling back to an implicit default", async () => {
    const { loadSigningKeyMaterial } = await import("@gatekeeper/crypto");
    await expect(loadSigningKeyMaterial(undefined)).rejects.toThrow();
    await expect(loadSigningKeyMaterial("")).rejects.toThrow();
  });
});
