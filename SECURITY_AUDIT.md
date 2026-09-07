# Gate Keeper Security Audit

Self-conducted, penetration-test-style review of this codebase, performed
as part of building it — not a substitute for an independent third-party
assessment before a real production launch. Written in the voice of an
external reviewer: what was tested, what was found, what was fixed, and
what remains a known, documented risk.

**Gate Keeper is not claimed to be unbreakable.** Per `docs/THREAT_MODEL.md`,
its security model is defense in depth across independent layers, not a
single unbeatable puzzle. This audit evaluates whether that model is
implemented correctly and where its edges are — not whether individual
CAPTCHA challenges can be solved by a sufficiently capable attacker
(they can; that is explicitly out of scope, see `docs/THREAT_MODEL.md` §9).

## Scope

- `packages/crypto`, `packages/challenges`, `packages/risk-engine`,
  `packages/rate-limit` — the security-critical primitives.
- `apps/api` — the verification API built on those primitives.
- `apps/dashboard` — the admin plane and its auth/RBAC.
- `packages/captcha-client`, `packages/captcha-server`, `packages/react`,
  `packages/vue`, `packages/offline` — the SDKs.
- Dependency supply chain (`npm audit`).

Not in scope: a live third-party network penetration test, infrastructure
hardening of a specific cloud deployment, or a formal cryptographic proof
of the signature/token scheme (which relies on `jose`'s well-reviewed
implementation of standard JOSE/JWT primitives, not custom cryptography).

## Methodology

- Manual review of every security-critical module against
  `docs/THREAT_MODEL.md`'s stated mitigations.
- An adversarial test suite (`tests/security/`, 51 tests) exercising the
  live HTTP API — not just unit tests of individual functions — covering:
  forged/tampered/expired/replayed tokens, cross-site/cross-action token
  theft, brute-force bounding, malformed/oversized requests, SQL
  injection and XSS payloads, SSRF/command-injection surface, auth/RBAC
  bypass attempts, CORS/CSRF posture, concurrent-request races, rate-limit
  bypass attempts, and static invariants (no `Math.random` in
  security-critical code, constant-time comparison for all secret
  checks).
- `npm audit` against the dependency tree.
- A load test (`tests/performance/load-test.mjs`) against a real running
  instance, which surfaced a genuine performance defect (see Findings).

## Findings

### F-1 — Audit log silently dropped attacker-forged challenge IDs (Medium, Fixed)

**Component:** `packages/shared/prisma/schema.prisma`,
`apps/api/src/routes/verify.ts`

**Description:** `VerificationAttempt.challengeId` was declared as a
foreign key to `Challenge.id`. When an attacker submitted a
`/api/v1/verify` request with a fabricated or guessed `challengeId` that
never corresponded to a real issued challenge, the fire-and-forget audit
write (`ctx.db.verificationAttempt.create(...)`) failed its FK constraint
and was silently swallowed by its `.catch()` handler. The verification
request itself still correctly failed (no bypass), but exactly the
attempts most worth auditing — forged/guessed challenge IDs — never
produced a database record.

**Reproduction:** `tests/security/token-integrity.test.ts`, "rejects a
completely forged envelope" and related cases, surfaced repeated Postgres
`FOREIGN KEY constraint` errors in test output.

**Impact:** Reduced incident-response visibility, not an authentication
or authorization bypass — the request was correctly rejected in all
cases. Still a real gap: an operator investigating a suspected attack
would have found fewer records than attempts actually made.

**Remediation:** Removed the foreign-key constraint; `challengeId` on
`VerificationAttempt` is now a plain audit field that records whatever
value was claimed, matching the reality that this table's job is to
record what happened, including bogus input, not to enforce referential
integrity against attacker-controlled data.

**Status:** Fixed. Verified via the now-passing security test suite.

### F-2 — TOTP-required response indistinguishable from generic auth failure (Low, Fixed)

**Component:** `apps/api/src/routes/admin.ts`

**Description:** The login endpoint initially collapsed every failure
case (wrong email, wrong password, missing/wrong TOTP code) into the same
generic `invalid_credentials` response, in the name of preventing account
enumeration. This broke legitimate two-factor UX: a client with a correct
password had no way to distinguish "you need a TOTP code" from "your
password is wrong."

**Impact:** Functional/UX defect, not independently exploitable — TOTP
was still correctly required and checked either way. Distinguishing
"password correct, TOTP required" from "credentials invalid" does not aid
an attacker's credential-guessing loop, since it is only reachable *after*
the password check already passed (an attacker with a wrong password
never sees it).

**Remediation:** The response now returns a distinct `401 totp_required`
only once the password has been verified; all other failure modes
(unknown account, disabled account, wrong password, wrong TOTP) still
collapse to the generic `invalid_credentials`.

**Status:** Fixed. Covered by `tests/integration/admin-routes.test.ts`
and `docs/API.md`.

### F-3 — Synchronous per-request DB reads on the verification hot path (Performance, Fixed)

**Component:** `apps/api/src/routes/challenge.ts`,
`apps/api/src/routes/verify.ts`

**Description:** Not a security vulnerability, included here because it
was found via the same adversarial/load-testing process. Every
`/api/v1/challenge` and `/api/v1/verify` call performed two synchronous
Prisma reads (site domain list, site config) before any other work. Under
concurrency, these queued on Prisma's connection pool and dominated
request latency (measured p50 ~530ms at concurrency 20 in a
resource-constrained sandbox).

**Remediation:** Added a 5-second-TTL in-process cache
(`apps/api/src/site-meta.ts`, `ttl-cache.ts`) for these two
low-security-sensitivity reads specifically, invalidated on config
updates. **Deliberately not applied** to API key resolution, which must
reflect revocation immediately. Measured ~4-7x median latency reduction
after the fix. Full writeup: `docs/PERFORMANCE.md`.

**Status:** Fixed.

### F-4 — Vulnerable dependencies in the runtime graph (High/Moderate, Fixed)

**Component:** `apps/demo` (`@fastify/static`), `apps/dashboard`
(`react-router-dom`)

**Description:** `npm audit --omit=dev` flagged `@fastify/static <=10.1.1`
(path traversal / route-guard-bypass / authorization-bypass advisories,
High) — used by `apps/demo` to serve the widget bundle — and
`react-router-dom 6.x` (open redirect / SSR deserialization advisories,
Moderate) — used by `apps/dashboard`.

**Impact:** `@fastify/static`'s advisories are specifically about
directory-listing/path-traversal and auth-bypass in its route-guarding
logic; `apps/demo`'s usage (serving a fixed, non-user-controlled
directory with `decorateReply: false`) narrows but does not eliminate the
exposure from an unpatched version. `react-router-dom`'s advisories
require the dashboard to render an attacker-influenced route/link value,
which the RBAC-gated admin app doesn't currently do — but leaving a known
vulnerable major version in place with no justification is not acceptable
practice regardless.

**Remediation:** Bumped `@fastify/static` to `^10.1.3` and
`react-router-dom` to `^7.18.3`. Verified both apps still typecheck and
build; the full test suite (199 tests) still passes after the bump.

**Status:** Fixed. `npm audit --omit=dev` now reports 0 vulnerabilities.

## Accepted risks / known limitations

These were identified and deliberately not fixed in this pass, with
reasoning:

- **Dev-tooling vulnerabilities remain** (`esbuild`/`vite`/`vitest`, 3
  moderate + 1 high + 1 critical per `npm audit`, dev dependencies only).
  These affect the Vite/esbuild *development server* accepting requests
  from any website when a developer runs `npm run dev` — they do not
  affect any built/shipped artifact or the production API. Fixing them
  requires a major-version bump across the whole Vite/Vitest toolchain,
  which risks destabilizing a fully-passing 199-test suite for a
  dev-only, non-production exposure. Recommendation: address in a
  dedicated follow-up with its own test-suite verification pass, not
  bundled into this build.
- **WebAuthn/passkey enrollment is not implemented.** The schema
  (`webauthn_credentials` table) and the product requirement ("MFA/
  passkeys where practical") anticipate it, but only TOTP is wired up end
  to end. Treat passkey support as a roadmap item, not a shipped feature.
- **No automated data-retention/pruning job.** `verification_attempts`,
  `risk_events`, `security_events`, `challenges`, and `audit_logs` grow
  indefinitely until an operator manually prunes them. `docs/PRIVACY.md`
  documents the intended `behavioralTelemetryTTLSeconds` knob, but no job
  consumes it yet. A production deployment with real compliance
  obligations (GDPR/CCPA data-minimization/retention rules) needs this
  before launch.
- **No key-rotation grace period.** Rotating `GATEKEEPER_SIGNING_KEY`
  invalidates every outstanding challenge/token immediately (single active
  key, no dual-key overlap window). Documented in `docs/SECURITY.md`;
  operationally means rotations should happen in low-traffic windows.
- **Admin dashboard session token is a JS-readable bearer token in
  `sessionStorage`**, not an httpOnly cookie. Chosen for implementation
  simplicity in this reference dashboard. A production deployment
  handling real customer data should migrate to httpOnly,
  `SameSite=Strict` cookies with CSRF double-submit protection to reduce
  exposure to any future XSS elsewhere on the dashboard's origin.
- **Single-tenant admin model.** Any authenticated administrator (with
  sufficient role) can see every site in the deployment's database — there
  is no per-site admin membership/isolation. This is the correct model for
  "one organization's Gate Keeper deployment, possibly protecting several
  of that organization's own sites" (comparable to most SaaS dashboards),
  but **it is not safe to run multiple unrelated customer organizations
  against one shared Gate Keeper deployment/database** without adding
  that isolation layer first. This is an architectural assumption, not an
  oversight — call it out explicitly to whoever operates a shared
  deployment.
- **No endpoint to add/remove domains on an existing site.** Domains are
  set only at site-creation time via the current API/dashboard. A real
  gap for any site whose allowed origins change post-launch; the
  workaround today is direct database access.
- **No production-scale load test performed.** `docs/PERFORMANCE.md`'s
  numbers come from a single-core development sandbox with an ephemeral
  embedded Postgres and an in-memory Redis mock — sufficient to validate
  that the F-3 fix worked and by roughly what factor, not a capacity
  planning figure. Run a real load test against staging infrastructure
  sized like production before launch.
- **No localization.** All challenge instructions and UI text are
  English-only (`docs/ACCESSIBILITY.md`).
- **No independent accessibility audit of the dashboard/demo apps** —
  only the CAPTCHA widget itself (the surface actually shown to
  end users of protected sites) received the accessibility rigor
  described in `docs/ACCESSIBILITY.md`.
- **The widget's browser bundle is unminified** (`packages/captcha-client`
  ships a readable, non-minified IIFE build, ~160KB). Fine functionally;
  a production CDN deployment should add a minification/compression step.
- **No CI/CD pipeline is configured in this repository.** All 199 tests
  must currently be run manually (`npm test` / `npx vitest run`). Add a
  CI workflow before relying on this for ongoing development by a team.

## What was verified and is believed sound

- Token/challenge signatures are unforgeable without the signing key
  (Ed25519/HMAC via `jose`); tampering with any signed claim, including a
  classic `alg: none` downgrade attempt, is rejected (`tests/security/
  token-integrity.test.ts`).
- Every challenge and token is single-use under real concurrent load —
  verified via genuine parallel HTTP requests against exactly-one-winner
  assertions, not just a theoretical Redis command's atomicity guarantee
  (`tests/security/concurrency-and-timing.test.ts`,
  `tests/integration/verify-flow.test.ts`).
- A token minted for one site/action cannot be spent against a different
  site or a different action (`SITE_MISMATCH`/`ACTION_MISMATCH`,
  verified end to end including the server-to-server secret-key flow).
- SQL injection payloads across login and site-name fields are inert —
  Prisma's parameterization holds under adversarial input; no query
  corruption observed.
- XSS payloads are stored and returned as inert JSON, never executed
  server-side; the dashboard renders all user/attacker-controlled text
  through React's default auto-escaping (no `dangerouslySetInnerHTML` on
  untrusted data anywhere in `apps/dashboard`).
- There is no SSRF surface — Gate Keeper never dereferences a
  customer-supplied URL server-side; domain values are compared as plain
  strings, never fetched.
- No shell execution of user input exists anywhere in the codebase.
- Passwords are hashed with scrypt, never stored in plaintext; API keys
  and session tokens are hashed with SHA-256 at rest and compared in
  constant time (`timingSafeEqual`) everywhere a secret is checked.
- Admin RBAC correctly denies `VIEWER` from key/config-mutating
  endpoints; login failures return a generic, non-enumerating error;
  revoked sessions and disabled accounts are rejected immediately.
- No security-critical randomness uses `Math.random` — verified both by
  code review and a static test asserting its absence from
  `packages/crypto`, `packages/challenges`, and `packages/rate-limit`.
- CSRF against the admin plane is defeated by two independent layers
  (JSON-only body parsing rejects a plain HTML form's content type; the
  bearer-token auth model has no ambient-cookie attack surface for a
  cross-site request to exploit even if it could produce a JSON body).

## Recommendation

Gate Keeper's core verification path (crypto, replay protection, rate
limiting, risk scoring) is implemented consistently with the design in
`docs/ARCHITECTURE.md` and holds up against the adversarial test suite in
this repository. Before a production launch handling real user traffic:

1. Commission an independent third-party security review — this document
   is a rigorous self-review, not a substitute for one.
2. Close the "Accepted risks" list above to the extent your deployment's
   risk tolerance requires (data retention automation and the dashboard's
   session-storage choice are the two most worth prioritizing).
3. Run a real load test against production-shaped infrastructure.
4. Stand up CI so the 199-test suite (and any you add) runs on every
   change, not manually.

Gate Keeper does not claim, and should never be marketed as, 100% bot
prevention — see `docs/THREAT_MODEL.md` §9 for the explicit list of
non-goals this audit reaffirms.
