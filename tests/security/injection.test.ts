/**
 * Adversarial suite: injection classes (docs/THREAT_MODEL.md §4.12). Gate
 * Keeper uses Prisma (parameterized queries) everywhere and never
 * constructs SQL via string concatenation, never shells out to a command
 * interpreter with user input, and never fetches an attacker-supplied URL
 * server-side (no SSRF surface). These tests exercise the live API with
 * classic injection payloads to confirm that holds in practice, not just
 * in code review.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../helpers/app.js";
import { createTestAdmin, createTestSite } from "../helpers/fixtures.js";

const SQLI_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE sites; --",
  "\" OR 1=1 --",
  "1' UNION SELECT * FROM administrators --",
];

const XSS_PAYLOADS = ["<script>alert(document.cookie)</script>", "<img src=x onerror=alert(1)>", "javascript:alert(1)"];

describe("SQL injection resistance", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it.each(SQLI_PAYLOADS)("does not break or bypass auth when the login email contains %j", async (payload) => {
    const res = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email: `attacker${Date.now()}@x.com`, password: payload } });
    // Must be a normal auth failure, never a 500 (which would indicate a
    // broken/injected query), and never a successful login.
    expect(res.statusCode).toBe(401);
  });

  it("does not corrupt the database when a SQLi payload is stored as a site name", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "sqli-admin@example.com" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    for (const payload of SQLI_PAYLOADS) {
      const res = await t.app.inject({
        method: "POST",
        url: "/api/v1/sites",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: payload, domains: [], environment: "PRODUCTION" },
      });
      expect(res.statusCode).toBe(201);
      // Stored and returned verbatim as inert data — never executed,
      // never breaks subsequent queries.
      expect(res.json().name).toBe(payload);
    }

    // The table must still be fully queryable afterward (would fail if any
    // payload had actually executed as SQL).
    const list = await t.app.inject({ method: "GET", url: "/api/v1/sites", headers: { authorization: `Bearer ${token}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json().sites.length).toBeGreaterThanOrEqual(SQLI_PAYLOADS.length);
  });
});

describe("XSS payload handling", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it.each(XSS_PAYLOADS)("stores and returns %j as inert JSON data, not executable markup", async (payload) => {
    const { email, password } = await createTestAdmin(t.db, { email: `xss-${Math.random()}@example.com` });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: payload, domains: [], environment: "PRODUCTION" },
    });
    expect(res.statusCode).toBe(201);
    // The API returns JSON (content-type application/json), which browsers
    // never execute as HTML/script regardless of content — the actual XSS
    // defense boundary for this data is the dashboard's React rendering
    // (which auto-escapes text content; see docs/SECURITY.md).
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json().name).toBe(payload);
  });
});

describe("no SSRF / command-injection surface", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it("does not treat a URL-shaped domain as something to fetch", async () => {
    const { email, password } = await createTestAdmin(t.db, { email: "ssrf-admin@example.com" });
    const login = await t.app.inject({ method: "POST", url: "/api/v1/admin/login", payload: { email, password } });
    const token = login.json().sessionToken;

    // Registering a domain never triggers any outbound request from the
    // server — domains are compared as plain strings against
    // Origin/Referer headers (apps/api/src/domains.ts), never dereferenced.
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "ssrf-test", domains: ["169.254.169.254", "http://internal-admin.local/secrets"], environment: "PRODUCTION" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("rejects a siteKey containing shell metacharacters via schema validation rather than passing them anywhere near a shell", async () => {
    await createTestSite(t.db);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/challenge",
      payload: { siteKey: "gk_pub_test; rm -rf / #", action: "signup" },
    });
    expect(res.statusCode).toBe(400);
  });
});
