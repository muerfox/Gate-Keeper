# Gate Keeper API Reference

Base URL: your deployment's API origin (self-hosted:
`http://localhost:8080` by default, per `docker-compose.yml`).

All request/response bodies are JSON. All endpoints validate their input
against a strict schema (`@gatekeeper/shared`'s Zod schemas) — unknown
fields are rejected, not silently ignored. All endpoints are versioned
under `/api/v1/`. A machine-readable OpenAPI document is at
`docs/openapi.yaml`.

## Authentication

Three distinct credential types, never interchangeable (see
`docs/THREAT_MODEL.md` §"Site Keys"):

| Type | Where it goes | Used by |
|---|---|---|
| Public site key | JSON body field `siteKey` | Browser widget — safe to expose |
| Secret server key | `Authorization: Bearer <key>` header | Your backend — never expose to a browser |
| Admin session token | `Authorization: Bearer <token>` header | The dashboard / admin API calls |

## Public / widget-facing endpoints

These accept a public site key and are meant to be called from a browser.
No admin session is required. All are rate-limited (IP, site, action,
session, API-key dimensions — see `docs/ARCHITECTURE.md`).

### `POST /api/v1/challenge`

Issues a new challenge.

**Request**
```jsonc
{
  "siteKey": "gk_pub_...",
  "action": "signup",           // 1-64 chars, [a-zA-Z0-9_.:-]
  "sessionHint": "optional",     // weak risk signal only, never an identity claim
  "accessible": false            // optional, requests the accessible challenge path
}
```

**Response `200`**
```jsonc
{
  "id": "…",
  "type": "pattern_recognition",
  "difficulty": 2,
  "siteId": "…",
  "action": "signup",
  "issuedAt": 1730000000000,
  "expiresAt": 1730000090000,
  "payload": { /* type-specific, never includes the answer */ },
  "signedEnvelope": "<compact JWS>"
}
```

**Errors**: `400 invalid_request`, `401 invalid_site_key`,
`403 domain_not_allowed`, `429 rate_limited`.

### `POST /api/v1/verify` (client-facing form)

Submits an answer for a previously issued challenge. Distinguished from
the server-facing form (below) by the presence of `challengeId`.

**Request**
```jsonc
{
  "siteKey": "gk_pub_...",
  "action": "signup",
  "challengeId": "…",
  "signedEnvelope": "<from the challenge response, unmodified>",
  "answer": /* type-specific — array, string, number, or object */,
  "events": [ { "t": 120, "type": "pointerdown" }, ... ]  // optional, capped at 500
}
```

**Response `200`** — always `200` even on failure; check `success`:
```jsonc
{ "success": true, "outcome": "SUCCESS", "riskLevel": "LOW", "token": "<signed token>" }
```
```jsonc
{ "success": false, "outcome": "FAILED_ANSWER", "riskLevel": "MEDIUM" }
```
```jsonc
{ "success": false, "outcome": "CHALLENGE_REQUIRED", "riskLevel": "HIGH", "nextChallenge": { /* PublicChallenge */ } }
```

`outcome` is one of: `SUCCESS`, `FAILED_ANSWER`, `EXPIRED`,
`ALREADY_CONSUMED`, `RISK_BLOCKED`, `RATE_LIMITED`, `INVALID_SIGNATURE`,
`SITE_MISMATCH`, `ACTION_MISMATCH`, `CHALLENGE_REQUIRED`.

**The returned `token` is not proof of anything until your backend
verifies it** — see the server-facing form below.

### `POST /api/v1/verify` (server-to-server form)

Distinguished by a `token` field (no `challengeId`) and requires a secret
key via `Authorization: Bearer`. **Atomically consumes the token** —
calling this twice with the same token always fails the second time.

**Request**
```
Authorization: Bearer gk_secret_...
```
```jsonc
{ "token": "<from the client-facing verify response>", "action": "signup" }
```

**Response `200`**
```jsonc
{ "success": true, "outcome": "SUCCESS", "riskLevel": "LOW" }
```

**Errors**: `400 invalid_request`, `401 missing_secret_key` /
`invalid_secret_key`, `429 rate_limited`.

Use the backend SDK (`@gatekeeper/captcha-server`) instead of calling this
directly where practical.

### `POST /api/v1/report`

Reports a false positive/negative or observed abuse for a site. Rate
limited; does not itself change any verification outcome.

```jsonc
{
  "siteKey": "gk_pub_...",
  "reason": "false_positive",  // | "false_negative" | "abuse_observed"
  "token": "optional",
  "detail": "optional free text, max 1000 chars"
}
```

Response `202 { "received": true }`.

## Admin endpoints

All require `Authorization: Bearer <admin session token>` and enforce
role-based access control (`VIEWER` < `ADMIN` < `OWNER`); each endpoint
below states the minimum role.

### `POST /api/v1/admin/login`

```jsonc
{ "email": "you@example.com", "password": "...", "totp": "123456" }
```
`200 { sessionToken, expiresAt, role }`. `401 invalid_credentials` (wrong
email/password, generic to avoid account enumeration) or `401
totp_required` (password was correct; a second factor is needed — safe to
distinguish since it only fires post-password-check). `429
too_many_attempts` under backoff.

### `POST /api/v1/admin/logout` — VIEWER

Revokes the current session. `204`.

### `POST /api/v1/admin/totp/setup` — VIEWER

Generates (but does not yet enable) a TOTP secret for the calling admin.
`200 { secret, otpauthUrl }`.

### `POST /api/v1/admin/totp/enable` — VIEWER

```jsonc
{ "totp": "123456" }
```
Confirms possession of the secret from `/totp/setup` and enables TOTP for
this account. `200 { enabled: true }`.

### `GET /api/v1/sites` — VIEWER

Lists all sites. `200 { sites: [...] }`.

### `GET /api/v1/site?siteId=...` — VIEWER

Full detail for one site: domains, config, and API keys (secret key
values are never included, only their prefix). `404` if not found.

### `POST /api/v1/sites` — ADMIN

```jsonc
{ "name": "My Site", "domains": ["example.com"], "environment": "PRODUCTION" }
```
`201`, the created site with domains and default config.

### `PATCH /api/v1/site/:id/config` — ADMIN

Partial update; any subset of: `lowRiskAutoAllow`, `criticalAction`
(`"block"|"throttle"`), `redisFailurePolicy`/`dbFailurePolicy`
(`"fail_open"|"fail_closed"`), `ipProcessingEnabled`, `analyticsEnabled`,
`computationalChallengesEnabled`. `200`, the updated config. `404` if the
site doesn't exist.

### `POST /api/v1/keys` — ADMIN

```jsonc
{ "siteId": "...", "type": "SECRET_SERVER_KEY", "environment": "PRODUCTION" }
```
`201 { id, type, environment, value }` — **`value` is shown exactly once**;
it is not retrievable again.

### `DELETE /api/v1/keys/:id` — ADMIN

Revokes a key immediately. `204`. `404` if not found.

### `GET /api/v1/challenges?siteId=&limit=&cursor=` — VIEWER

Recently issued challenges (audit view). `200 { challenges, nextCursor }`.

### `GET /api/v1/verification-attempts?siteId=&limit=&cursor=` — VIEWER

`200 { attempts, nextCursor }`.

### `GET /api/v1/events?siteId=&type=&limit=&cursor=` — VIEWER

Security events, optionally filtered by `type` (one of the
`SecurityEventType` enum values — see `docs/API.md`'s schema reference or
`packages/shared/prisma/schema.prisma`). `200 { events, nextCursor }`.

### `GET /api/v1/analytics?siteId=&windowHours=` — VIEWER

Aggregated metrics for the given window (default 24h): total requests,
successful/failed verifications, outcome breakdown, risk level
distribution, rate-limit event count, average verification latency.

### `GET /api/v1/audit-logs?limit=&cursor=` — VIEWER

Privileged admin actions (site/key creation, revocation, config changes).
`200 { logs, nextCursor }`.

## Rate limiting

Every endpoint above (except pure `GET` admin reads, which are gated by
auth rather than rate limits) is checked against multiple simultaneous
dimensions — see `docs/ARCHITECTURE.md`'s rate-limiting section for the
full rule table. A `429` response includes `{ "error": "rate_limited",
"rule": "<which dimension tripped>" }` where determinable.

## Request size limits

Every request body is capped at `MAX_REQUEST_BODY_BYTES` (32 KiB) —
oversized requests are rejected with `413` before any parsing occurs.
Interaction-event arrays are separately capped at 500 entries regardless
of byte size.

## OpenAPI

See `docs/openapi.yaml` for a machine-readable OpenAPI 3.0 document
covering the public (widget-facing) endpoints — suitable for generating
API clients or importing into API testing tools.
