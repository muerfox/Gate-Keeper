# Gate Keeper Security Guide

Practical security guidance for operators and integrators. For the
underlying design and rationale, see `docs/THREAT_MODEL.md` and
`docs/ARCHITECTURE.md`. For what is and isn't collected, see
`docs/PRIVACY.md`.

## Reporting a vulnerability

If you find a security issue in Gate Keeper itself, please report it
privately rather than opening a public issue — give the maintainers a
reasonable window to fix it before any public disclosure. Include:
reproduction steps, affected version/commit, and impact assessment.

## Key management

- **Secret server keys are shown exactly once**, at creation time (the
  dashboard's key-reveal panel). If you lose one, revoke it and create a
  new one — there is no "show again."
- **Never commit a secret key to source control.** Load it from your
  platform's secret manager or environment variables at runtime.
- **Rotate keys periodically and after any suspected exposure.** Create
  the new key, deploy it, confirm traffic has shifted, then revoke the
  old one — there is currently no automatic overlap/grace-period
  mechanism, so plan the cutover explicitly (this is a known gap; see
  `SECURITY_AUDIT.md`).
- **Public site keys are not secret** — they are designed to be embedded
  in browser JavaScript. Their protection comes from domain restriction
  (below) and the server-side checks in `docs/THREAT_MODEL.md`, not from
  keeping them hidden.
- **Restrict every production site to its real domains.** An
  unrestricted (no domains registered) site accepts its public key from
  any origin — convenient for local development, not appropriate for
  production. Register `example.com`, `www.example.com`, `app.example.com`
  etc. explicitly (exact match, no wildcards).

## Signing keys (`GATEKEEPER_SIGNING_KEY`)

- Generate with `generateEd25519KeyMaterial()` (recommended for hosted/
  online deployments) or `generateHmacKeyMaterial()` (simpler, appropriate
  for self-hosted/offline — see `docs/OFFLINE_MODE.md`) from
  `@gatekeeper/crypto`.
- Store it in your secret manager, not in `.env` files committed anywhere,
  not in application logs.
- **Rotating the signing key invalidates every outstanding challenge and
  token immediately** (they fail signature verification against the new
  key). Plan rotations for low-traffic windows, or accept the brief wave
  of `INVALID_SIGNATURE` outcomes as legitimate users re-request a
  challenge.
- `GATEKEEPER_ENCRYPTION_KEY` (AES-256-GCM, protects administrators'
  encrypted-at-rest TOTP seeds) should be generated with
  `generateEncryptionKey()` and handled with the same care.

## Admin account security

- Passwords are hashed with scrypt (a memory-hard KDF) — never stored in
  plaintext, never logged.
- Enable TOTP for every administrator account that can create/revoke keys
  or change site configuration (`ADMIN`/`OWNER` roles). Passkey/WebAuthn
  support is scaffolded in the schema (`webauthn_credentials` table) but
  the enrollment/assertion ceremony is **not yet implemented** — see
  `SECURITY_AUDIT.md` for this as a known gap.
- Use the least-privilege role that gets the job done: `VIEWER` for
  anyone who only needs to read dashboards/analytics, `ADMIN` for people
  who manage sites/keys, `OWNER` sparingly.
- Session tokens are bearer tokens over `Authorization: Bearer <token>`,
  hashed at rest (never stored or logged in plaintext), with a 12-hour
  expiry and explicit revocation on logout. The reference dashboard
  stores the token in `sessionStorage` (cleared when the tab closes, not
  shared cross-tab). **A production deployment serving real customer data
  should prefer httpOnly, `SameSite=Strict` cookies with CSRF-token
  double-submit** over a JS-readable bearer token, to reduce the token's
  exposure to any XSS that might occur elsewhere on the dashboard's
  origin. This reference implementation prioritized simplicity; harden
  this before a public launch.
- Login failures (wrong password, wrong TOTP, or a non-existent account)
  are rate-limited with exponential backoff, keyed by `email:ip`, and all
  return an identical generic error to avoid leaking account existence.
  TOTP-required is the one deliberately distinguishable response — it
  only fires after the password has already been verified, so revealing
  it does not aid a credential-guessing attacker.

## Security headers

`apps/api` applies (`@fastify/helmet`): a restrictive `Content-Security-
Policy` (`default-src 'none'`, appropriate for a pure-JSON API), HSTS,
`Referrer-Policy: strict-origin-when-cross-origin`, and
`Cross-Origin-Resource-Policy: cross-origin` (the widget is deliberately
embedded on third-party origins).

The dashboard (served by nginx, see
`infrastructure/docker/dashboard.nginx.conf`) applies its own CSP suited
to an interactive SPA: `default-src 'self'`, connect to `https:` (the
configured API origin), no inline scripts, no framing.

### CSP guidance for YOUR site embedding the widget

Gate Keeper cannot set headers on a page it doesn't serve — you control
your own site's CSP. To embed the widget:

```
script-src 'self' https://your-gatekeeper-cdn-or-origin;
connect-src 'self' https://your-gatekeeper-api-origin;
frame-src 'none';
```

The widget renders inside a Shadow DOM it creates itself — it does not
need `frame-src` or `unsafe-inline`.

## CORS and CSRF posture

- `POST /api/v1/challenge`, `POST /api/v1/verify`, and `POST
  /api/v1/report` intentionally respond regardless of `Origin` — that is
  the point of a hosted CAPTCHA embedded on arbitrary customer sites.
  Trust for these endpoints comes from the signed envelope/token and the
  domain allow-list (`docs/THREAT_MODEL.md` §4.3), never from CORS, which
  is a browser-enforced control an out-of-browser attacker simply ignores.
- The admin API requires an explicit `Authorization: Bearer` header, never
  an ambient cookie, which by itself defeats classic CSRF (a cross-site
  `<form>` submission has no way to attach that header, and — as a second
  independent layer — can't produce the `application/json` body Fastify
  requires; see `tests/security/auth-and-access.test.ts`).

## Dependency and supply-chain hygiene

- All cryptography goes through `jose` (JOSE/JWT) and Node's built-in
  `node:crypto` — no hand-rolled primitives (`docs/THREAT_MODEL.md`: "do
  not invent cryptography").
- Run `npm audit` regularly; this repository had known moderate/high
  advisories in transitive dev dependencies at the time of writing — none
  in the runtime dependency graph of `apps/api` itself, but review before
  shipping (see `SECURITY_AUDIT.md`).
- Pin dependency versions in `package-lock.json` (committed) and review
  diffs on updates rather than blindly bumping.

## Failure-mode policy

Choose `redisFailurePolicy` / `dbFailurePolicy` (fail-open vs. fail-closed)
per site based on your own risk tolerance — see
`docs/ARCHITECTURE.md` §Failure Modes. Every degraded-dependency event is
logged as a `SecurityEvent` (`REDIS_DEGRADED` / `DB_DEGRADED`); alert on
these in production.
