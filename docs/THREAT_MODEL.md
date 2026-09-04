# Gate Keeper Threat Model

Status: living document. Update whenever a new attack, mitigation, or limitation is discovered.

Gate Keeper's design premise is explicit: **no CAPTCHA is mathematically unbreakable.** A
sufficiently resourced attacker with a human-solving farm, or a good-enough ML model, will
eventually pass any individual challenge. Gate Keeper's job is to make *automated, high-volume*
abuse expensive, slow, and detectable — not to make solving impossible for a single determined
human or a single well-funded attacker. Security comes from combining independent layers
(cryptographic integrity, replay protection, rate limiting, behavioral analysis, and adaptive
escalation) so that defeating Gate Keeper at scale requires defeating all of them simultaneously,
continuously, and cheaply. If any single layer fails, the others must still hold.

## 1. Assets

What Gate Keeper protects, and what an attacker wants:

| Asset | Why it matters |
|---|---|
| Protected site actions (signup, login, checkout, comment, etc.) | The actual thing being abused (fake accounts, credential stuffing, scalping, spam) |
| Verification tokens | Proof of a passed check; theft/forgery = free bypass |
| Secret server keys | Compromise lets an attacker mint verification results directly against the API |
| Signing keys (challenge/token signing secrets) | Compromise lets an attacker forge arbitrary valid tokens without ever solving a challenge |
| Site/domain configuration | Determines which origins a public key may be used from; tampering enables cross-site token reuse |
| Risk/behavioral telemetry | Feeds the risk engine; poisoning it degrades detection for everyone |
| Administrator accounts | Control plane of the whole system — compromise is total compromise of a tenant |
| Rate limit / replay state (Redis) | Availability and correctness directly gate abuse throughput |
| End-user privacy | Behavioral signals are inherently personal; over-collection is itself a harm |

## 2. Attacker Capabilities (assumed, not hypothetical)

Gate Keeper is designed assuming the attacker can, at will:

- Read, modify, and re-serve any client-side JavaScript (the widget is not a secret).
- Disable JavaScript entirely, or run a JS engine that lies about DOM/API behavior.
- Drive a real browser via Chromium/Firefox automation (Playwright, Puppeteer, Selenium) with a
  real rendering and JS engine, real event loop, and scriptable input events.
- Inspect and replay every network request the widget makes, byte for byte.
- Patch or proxy browser APIs (`navigator`, `screen`, `Notification.permission`, WebGL, canvas,
  `PointerEvent`, timers) to fabricate "signals" the widget relies on.
- Forge or fabricate client-side timing values, mouse paths, and keystroke sequences.
- Solve individual visual/interactive challenges using a human click-farm or an ML model trained
  for that specific challenge family.
- Extract, redistribute, or resell verification tokens (token farming / token relay attacks).
- Run many browser instances in parallel, from many source IPs (residential proxy pools,
  cloud IP ranges), to defeat naive per-IP controls.
- Reverse engineer the widget's bundle, obfuscation, and wire protocol.
- Attack `/api/v1/*` directly with hand-crafted HTTP requests, skipping the widget/browser
  entirely.
- Attempt to brute force, guess, or enumerate site keys, secret keys, challenge IDs, and nonces.

**Explicitly out of scope as "solved":** Gate Keeper does not claim to distinguish a real human
solving one challenge from a paid human solving the same challenge (CAPTCHA farms). Economic
cost, rate limiting, and risk scoring are the mitigations there, not challenge design.

## 3. Trust Boundaries

```
[ Untrusted ]                         [ Trust boundary ]              [ Trusted ]
Browser / widget JS  ------ network -------->  Gate Keeper API  ---->  Postgres / Redis
Automated HTTP client                          (verifies everything)   Signing secrets
Customer's own frontend                                                Risk engine state
Customer's own backend  ---- secret key ---->  Gate Keeper API (server SDK call)
```

Hard rule: **anything that crosses from browser to server is untrusted input**, including
challenge "answers," claimed timing, claimed risk scores, claimed device signals, and the
verification token itself. The only things Gate Keeper trusts are:

1. Values it generated itself and can cryptographically re-verify (challenge ID, nonce,
   signature, expiry).
2. Values it observed directly on its own server (arrival timestamps, IP as seen by the
   TCP/TLS terminator, request rate).
3. The customer's secret server key, presented server-to-server over TLS.

A corollary: **the customer's own backend must call Gate Keeper's verify API itself.** A
`success` flag returned to (or fabricated by) the browser is never sufficient; the SDKs make the
server-side call the only supported "did this pass" check.

## 4. Threats and Mitigations

### 4.1 Token forgery / tampering
- **Threat:** attacker crafts or edits a token to claim success.
- **Mitigation:** tokens are authenticated (signed) using established primitives (Ed25519 via
  `jose`, or HMAC-SHA256 for symmetric deployments). Signature covers all claims. Verification
  recomputes/checks the signature server-side; any mutation invalidates it. Signing keys never
  leave the server process (env/secret store), never ship to the browser, and are distinct per
  environment (dev/prod) and rotatable.

### 4.2 Replay
- **Threat:** attacker captures a valid token/challenge-response and resubmits it, or submits it
  many times concurrently, to farm multiple "passes" from one solve.
- **Mitigation:** every challenge and token carries a unique server-generated nonce and is
  single-use. Consumption is an atomic, race-free operation (Redis `SET NX` / Lua script, with a
  DB-backed unique-constraint fallback) so that under concurrent submission exactly one request
  wins and all others are rejected as `already_consumed`. Tokens are also short-lived
  (default ≤ 120s) to bound the replay window even if the consumption store is briefly
  unavailable. See `docs/ARCHITECTURE.md` §Replay Protection for the exact atomicity guarantee.

### 4.3 Cross-site / cross-action token reuse
- **Threat:** a token solved for `site A / action "login"` is replayed against `site B` or
  against a more sensitive action (`"checkout"`) on the same site.
- **Mitigation:** the site ID and action string are bound into the signed token payload and
  checked exactly on verification. A public site key is also domain-restricted server-side
  (allow-list of registered origins); a challenge issued for an unregistered `Origin`/`Referer`
  is rejected before a token is ever minted.

### 4.4 Automation / scripted solving
- **Threat:** headless browsers or raw HTTP clients solve challenges programmatically at scale,
  or skip the widget and hit the API directly.
- **Mitigation:** defense in depth, not one signal:
  - Server-side behavioral consistency analysis of the *entire* interaction sequence (event
    ordering, timing plausibility, focus/visibility transitions) rather than a single "mouse
    moved" boolean (see §4.9).
  - Rate limiting at IP, site, action, session, challenge, token, and API-key granularity.
  - Adaptive escalation: low-confidence or inconsistent sessions are pushed to harder challenge
    categories or blocked, rather than the system relying on the first challenge being unsolvable
    by automation.
  - Direct API abuse (skipping the widget) still requires producing a validly-signed challenge
    response within the expiry window and passing the same replay/rate-limit/risk checks — there
    is no "widget-only" trust shortcut in the server.
- **Explicit non-mitigation:** Gate Keeper does **not** rely on browser fingerprinting as a
  primary signal, because fingerprints are spoofable by a sufficiently capable automation stack.
  Fingdisable-able/optional signals are treated as weak, corroborating evidence only.

### 4.5 CAPTCHA-solving services / human farms
- **Threat:** challenge images/data are relayed to a human solver service in real time.
- **Mitigation:** this is fundamentally a cost problem, not a puzzle-design problem. Mitigations
  are economic and behavioral: short challenge expiry (limits relay round-trip budget), risk-based
  escalation (repeat offenders from the same network/session see harder/more frequent challenges),
  velocity limits on challenge issuance per IP/session, and anomaly detection on solve-time
  distributions (farm solve times cluster differently from organic human solve times, and
  render as a corroborating — never sole — signal).

### 4.6 Client tampering / reverse engineering
- **Threat:** attacker reads and modifies the widget's JS to fabricate favorable telemetry.
- **Mitigation:** assume it will happen. No security decision depends on client-reported
  telemetry being honest — the server treats all client-reported behavioral data as *evidence to
  be scored*, never as an assertion to trust. The widget's obfuscation/integrity measures (if any)
  are a speed bump for casual attackers, explicitly **not** a security boundary.

### 4.7 Credential / secret theft
- **Threat:** secret server key or signing key leaks (repo commit, log leak, SSRF, compromised
  dependency).
- **Mitigation:** secret keys are never sent to or derivable by browser JS. Keys support
  rotation (old + new valid during a grace window) via the dashboard/API. Audit log records every
  key creation/rotation/deletion. Secrets are never logged; log redaction is enforced at the
  logger config level, not per call site.

### 4.8 Distributed / low-and-slow abuse
- **Threat:** attacker spreads requests across many IPs/sessions to stay under per-IP limits.
- **Mitigation:** rate limiting composes across multiple keys simultaneously (IP *and* site *and*
  action *and* API key, etc.), and the risk engine aggregates signals at the site/action level
  (e.g., global velocity of a given action across all sessions), not only per-IP. This raises
  the number of distinct identities an attacker must control, which raises cost, but cannot make
  distributed abuse impossible — documented as a residual risk (§6).

### 4.9 Behavioral spoofing
- **Threat:** attacker synthesizes plausible-looking mouse/keyboard event streams.
- **Mitigation:** the risk engine checks *internal consistency* across independent event
  channels (pointer trajectory vs. pointer-down/up timestamps vs. focus/visibility changes vs.
  the server-issued nonce/timer), not any single channel's presence. Impossible or
  statistically-implausible combinations (e.g., a completion time faster than the challenge's
  minimum human-perception threshold, pointer events with zero jitter, focus events with no
  corresponding visibility change) raise risk. This raises attacker cost (a good synthetic
  generator is real engineering effort) without claiming detection is guaranteed — documented as
  a residual risk (§6, §8 false positives).

### 4.10 API abuse independent of the widget
- **Threat:** attacker never loads the page; scripts requests straight at `/api/v1/*`.
- **Mitigation:** every endpoint independently validates origin/referrer where applicable,
  enforces the same rate limits and payload schemas, and requires a validly-signed,
  unexpired, unconsumed challenge/token for any state-changing outcome. There is no endpoint
  whose security depends on "the widget called it correctly."

### 4.11 Denial of Service
- **Threat:** flooding `/challenge` to exhaust compute/DB/Redis, or flooding `/verify` with
  garbage to burn CPU on signature checks.
- **Mitigation:** strict request size limits, cheap-first validation ordering (schema/size checks
  before any crypto or DB work), per-IP and per-site issuance rate limits, and computational
  challenges are bounded and admin-configurable (never scaled up to be a DoS vector against
  legitimate low-power clients). Redis/DB unavailability triggers documented fail-open/fail-closed
  policy (see `docs/ARCHITECTURE.md` §Failure Modes) rather than unbounded retries or crashes.

### 4.12 Injection (SQLi, XSS, command/SSRF)
- **Threat:** standard web app injection classes against the API, dashboard, or widget.
- **Mitigation:** all DB access via parameterized queries/ORM (Prisma) — no string-concatenated
  SQL anywhere in the codebase. Dashboard renders all user/attacker-controlled data
  (site names, domains, event metadata) with framework auto-escaping; no `dangerouslySetInnerHTML`
  / `v-html` on untrusted data. No server-side fetch of user-supplied URLs (no SSRF surface) —
  Gate Keeper does not fetch arbitrary customer-provided URLs. Covered concretely in
  `tests/security/`.

### 4.13 Admin plane compromise
- **Threat:** attacker gains access to the dashboard / admin API.
- **Mitigation:** password hashing via a memory-hard KDF (Argon2id), mandatory rate limiting +
  backoff on login, session expiration, RBAC (owner/admin/viewer roles minimum), optional
  MFA (TOTP) and WebAuthn/passkey support, full audit logging of privileged actions, and secret
  values (keys) shown only once at creation time.

## 5. Privacy Threats

- **Threat:** behavioral telemetry becomes a de-facto persistent tracking identifier.
- **Mitigation:** no persistent cross-site identifier is created by default; session-scoped
  identifiers expire with the verification flow. IP processing, raw event retention, and
  analytics are administrator-configurable and default to minimal collection + short retention.
  See `docs/PRIVACY.md` for the full data inventory.
- **Threat:** operators over-collect "just in case."
- **Mitigation:** the schema and API only support the fields documented in `docs/PRIVACY.md`;
  adding new collection categories is a deliberate schema change, not a silent default.

## 6. Offline / Self-Hosted Limitations

Offline mode issues and verifies challenges entirely within the customer's own environment, with
no call to a centralized Gate Keeper service. This necessarily removes:

- Cross-customer reputation and shared abuse intelligence.
- Centralized, hard-to-tamper-with rate limiting (a self-hosted attacker with infrastructure
  access can inspect or reset local rate-limit state).
- Any protection against an attacker who has access to the same machine/network as the verifying
  server (e.g., an insider, or a compromised host), since the signing secret lives locally.

**Offline mode is explicitly weaker against a sophisticated attacker than online mode**, and this
document, `docs/OFFLINE_MODE.md`, and the package README all say so. It is intended for
intranets/air-gapped environments where the alternative is no bot mitigation at all, not as a
drop-in equivalent to the hosted service.

## 7. Denial-of-Service Considerations (Gate Keeper as a dependency)

If Gate Keeper becomes unavailable or degraded, it must not become a worse outage than the abuse
it prevents. Administrators explicitly configure fail-open vs. fail-closed behavior per
integration; whichever is chosen, a degraded state is logged as a security event, never silently
absorbed. See `docs/ARCHITECTURE.md` §Failure Modes.

## 8. False-Positive Risks

Aggressive anti-automation heuristics can wrongly flag real users, especially:

- Users of assistive technology (switch devices, eye-tracking input, screen readers driving
  synthetic DOM events) whose interaction patterns are legitimately atypical.
- Users on high-latency or high-jitter connections/networks, or behind carrier-grade NAT sharing
  an IP with many other users.
- Privacy-tool users (VPNs, Tor, proxy browsers, aggressive script blockers) who present fewer
  signals by design.
- Users with motor impairments whose pointer trajectories are naturally atypical.

Gate Keeper's response is architectural, not cosmetic: accessible challenge alternatives are a
first-class challenge category (not a fallback bolted on later), risk scoring is
probabilistic/graduated (MEDIUM risk gets a light challenge, not an automatic block), and CRITICAL
outcomes are rate-limited/throttled rather than permanent bans by default. Operators are warned in
`docs/ACCESSIBILITY.md` and `docs/PRIVACY.md` against tightening thresholds without measuring
false-positive impact on real traffic.

## 9. Explicit Non-Goals / Non-Claims

Gate Keeper does not, and will not claim to:

- Guarantee 100% bot prevention.
- Distinguish a paid human solver from a genuine user.
- Provide equivalent trust guarantees in offline/self-hosted mode as in the hosted online mode.
- Replace application-level authorization/authentication.
- Serve as the sole defense for a security-critical action — it is one layer among the
  customer's own defenses (auth, WAF, application logic).
