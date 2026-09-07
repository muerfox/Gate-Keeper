import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../helpers/app.js";
import { createTestAdmin, createTestSite } from "../helpers/fixtures.js";

async function loginAs(t: TestApp, email: string, password: string) {
  const res = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
  return res;
}

describe("admin authentication", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("logs in with correct credentials and returns a usable session token", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "owner@example.com" });
    const res = await loginAs(t, email, password);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionToken).toBeTruthy();
    expect(body.role).toBe("OWNER");

    const sites = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: `Bearer ${body.sessionToken}` } });
    expect(sites.statusCode).toBe(200);
  });

  it("rejects a wrong password with a generic error (no account-existence leak)", async () => {
    const { email } = await createTestAdmin(t.db, { email: "owner2@example.com", password: "correct password" });
    const res = await loginAs(t, email, "wrong password");
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_credentials");
  });

  it("returns the same generic error for a non-existent account", async () => {
    const res = await loginAs(t, "nobody@example.com", "whatever");
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_credentials");
  });

  it("applies exponential backoff after repeated failed attempts", async () => {
    const { email } = await createTestAdmin(t.db, { email: "backoff@example.com", password: "correct password" });
    for (let i = 0; i < 3; i++) {
      await loginAs(t, email, "wrong");
    }
    const res = await loginAs(t, email, "wrong");
    expect(res.statusCode).toBe(429);
    expect(res.json().retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rejects API access without a session token", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/v1/sites" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects API access with a garbage bearer token", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: "Bearer not-a-real-session-token" } });
    expect(res.statusCode).toBe(401);
  });

  it("logout revokes the session", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "logout-test@example.com" });
    const login = await loginAs(t, email, password);
    const token = login.json().sessionToken;

    const logout = await t.app.inject({ method: "POST", url: "/api/v1/admin/logout", headers: { authorization: `Bearer ${token}` } });
    expect(logout.statusCode).toBe(204);

    const after = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: `Bearer ${token}` } });
    expect(after.statusCode).toBe(401);
  });
});

describe("RBAC enforcement", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("allows a VIEWER to read but not create sites", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "viewer@example.com", role: "VIEWER" });
    const login = await loginAs(t, email, password);
    const token = login.json().sessionToken;

    const read = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: `Bearer ${token}` } });
    expect(read.statusCode).toBe(200);

    const write = await t.app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "should not be created", domains: [], environment: "PRODUCTION" },
    });
    expect(write.statusCode).toBe(403);
  });

  it("allows ADMIN to create sites and keys", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "admin-role@example.com", role: "ADMIN" });
    const login = await loginAs(t, email, password);
    const token = login.json().sessionToken;

    const create = await t.app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Admin-created site", domains: [], environment: "PRODUCTION" },
    });
    expect(create.statusCode).toBe(201);
  });
});

describe("site/key management routes", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  async function ownerToken(): Promise<string> {
    const { email, password } = await createTestAdmin(t.db, { email: `owner-${Math.random()}@example.com` });
    const login = await loginAs(t, email, password);
    return login.json().sessionToken;
  }

  it("creates a site with domains via the API", async () => {
    const token = await ownerToken();
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "My Site", domains: ["example.com"], environment: "PRODUCTION" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().domains).toHaveLength(1);
  });

  it("creates a secret key, returns its value once, and never leaks it again via GET /site", async () => {
    const token = await ownerToken();
    const { site } = await createTestSite(t.db);

    const created = await t.app.inject({
      method: "POST",
      url: "/api/v1/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { siteId: site.id, type: "SECRET_SERVER_KEY", environment: "PRODUCTION" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().value).toMatch(/^gk_secret_/);

    const fetched = await t.app.inject({ method: "GET", url: `/api/v1/site?siteId=${site.id}`, headers: { authorization: `Bearer ${token}` } });
    const secretKeyRow = fetched.json().apiKeys.find((k: { type: string }) => k.type === "SECRET_SERVER_KEY" && !k.publicValue);
    expect(JSON.stringify(fetched.json())).not.toContain(created.json().value);
    expect(secretKeyRow).toBeTruthy();
  });

  it("revokes a key so it can no longer authenticate", async () => {
    const token = await ownerToken();
    const { site, secretKey } = await createTestSite(t.db);

    const beforeRevoke = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      headers: { authorization: `Bearer ${secretKey}` },
      payload: { token: "not-a-real-token", action: "signup" },
    });
    expect(beforeRevoke.statusCode).not.toBe(401); // key itself is still valid (token content is bogus, that's a separate failure)

    const keys = await t.db.apiKey.findMany({ where: { siteId: site.id, type: "SECRET_SERVER_KEY" } });
    const keyId = keys[0]!.id;
    const revoke = await t.app.inject({ method: "DELETE", url: `/api/v1/keys/${keyId}`, headers: { authorization: `Bearer ${token}` } });
    expect(revoke.statusCode).toBe(204);

    const afterRevoke = await t.app.inject({
      method: "POST",
      url: "/api/v1/verify",
      headers: { authorization: `Bearer ${secretKey}` },
      payload: { token: "not-a-real-token", action: "signup" },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it("updates site config via PATCH", async () => {
    const token = await ownerToken();
    const { site } = await createTestSite(t.db);

    const res = await t.app.inject({
      method: "PATCH",
      url: `/api/v1/site/${site.id}/config`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ipProcessingEnabled: true, criticalAction: "throttle" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ipProcessingEnabled).toBe(true);
    expect(res.json().criticalAction).toBe("throttle");
  });

  it("records an audit log entry for privileged actions", async () => {
    const token = await ownerToken();
    await t.app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Audited site", domains: [], environment: "PRODUCTION" },
    });

    const logs = await t.app.inject({ method: "GET", url: "/api/v1/audit-logs", headers: { authorization: `Bearer ${token}` } });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().logs.some((l: { action: string }) => l.action === "site.create")).toBe(true);
  });
});
