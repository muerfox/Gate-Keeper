# Gate Keeper Offline Mode

`@gatekeeper/offline` issues and verifies Gate Keeper challenges and tokens
entirely within your own process — no call to the hosted API, no Redis, no
Postgres. It exists for intranets, private networks, self-hosted
applications, restricted environments, and air-gapped systems where the
alternative is no bot mitigation at all.

**Read this document before choosing offline mode.** It is not a drop-in,
security-equivalent replacement for the hosted online service. It reuses
the same cryptography and challenge engine (`@gatekeeper/crypto`,
`@gatekeeper/challenges`, `@gatekeeper/risk-engine`) — the difference is
entirely in *where state lives* and *what intelligence is available* — and
both of those differences make offline mode weaker against a sophisticated
attacker than online mode. See `docs/THREAT_MODEL.md` §6 for the summary;
this document is the detailed version.

## What you get

- Cryptographically signed, single-use, expiring challenges — same
  properties as online mode (random ID/nonce, site+action binding, server
  signature).
- The same dynamic challenge engine (11 categories) and the same
  behavioral-consistency risk scoring (Layer 3/4), run locally.
- A `verifyToken()` call your own backend can use to enforce single-use
  tokens, the same way the hosted API's secret-key verify endpoint does.

## What you explicitly do NOT get

### 1. No distributed replay protection

Challenge and token consumption state lives in a JavaScript `Map` in this
process's memory (`packages/offline/src/memory-store.ts`), not in Redis.
Consequences:

- **Restart the process and all in-flight challenges/tokens are
  forgotten.** A challenge issued right before a restart can never be
  answered afterward (fails safe — it will read as `ALREADY_CONSUMED`/
  expired, not as valid).
- **Running more than one instance breaks the single-use guarantee.** If
  you run this behind a load balancer with multiple worker processes (or
  multiple machines), each instance has its own independent memory — the
  same token could be "consumed" once per instance, not once globally.
  Offline mode is supported and safe for **single-process** deployments
  only. If you need multiple instances, you need a shared store, at which
  point you are most of the way to re-deriving online mode's architecture
  yourself — use online mode (self-hosted, with your own Redis/Postgres)
  instead.

### 2. No cross-customer/cross-deployment abuse intelligence

Online mode's risk engine can (when enabled) draw on aggregate signals
across many sites and many customers. An offline instance only ever sees
its own local traffic. It cannot know that an IP or pattern is currently
hammering a hundred other unrelated deployments.

### 3. No IP reputation

Nothing in this package looks up IP reputation. If you want that signal
offline, you must supply it yourself and pass it into your own risk
scoring — there is no equivalent to the online risk engine's
`ipReputation` input.

### 4. No persistent audit log, dashboard, analytics, or admin plane

There is no database. Every `issue()`/`verify()`/`verifyToken()` call
returns data synchronously to your caller; nothing is written anywhere
unless you write it yourself. If you need an audit trail, a dashboard, or
historical analytics for an offline deployment, you must build that layer
on top of this package's return values.

### 5. Key management is entirely your responsibility

`createOfflineGateKeeper({ signingKey })` takes a single HMAC secret you
generate with `generateHmacKeyMaterial()` and are responsible for storing
securely (a secrets manager, an encrypted config file — never source
control) and rotating. There is no key-rotation UI, no grace-period
dual-key verification, and no separation between an "issuing" key and a
"verifying" key (HMAC is symmetric — whoever can verify can also forge).
If you omit `signingKey`, one is generated in memory at startup: fine for
a short-lived CLI tool or test harness, unsuitable for anything that needs
to survive a restart.

### 6. The insider/same-host threat is not mitigated

Because issuance and verification happen in the same process, on the same
machine, holding the same secret — anyone with access to that process or
machine (a compromised host, a malicious insider with shell access) has
everything needed to forge a passing verification. Online mode's
signing key lives on Gate Keeper's own infrastructure, separate from your
application server; offline mode collapses that separation by design.
Weigh this specifically for high-value actions.

## When offline mode is a reasonable choice

- An internal tool on a private corporate network with no internet egress.
- An air-gapped system where no external service call is possible at all.
- A local development/staging environment.
- A single-process embedded application where the operator already trusts
  the host machine and process to the same degree they'd trust an online
  API key.

## When to use online (self-hosted) mode instead

- You need more than one verifying process/instance.
- You need an audit log, dashboard, or analytics.
- You want IP reputation or cross-deployment abuse signals.
- The action being protected is high-value enough that the insider/
  same-host threat above is unacceptable.

Self-hosted online mode (running `apps/api` yourself against your own
Postgres/Redis, per `docker-compose.yml`) gets you the full architecture
without depending on Gate Keeper's hosted infrastructure, while avoiding
every limitation above except key-rotation tooling maturity.

## Usage

```ts
import { createOfflineGateKeeper, generateHmacKeyMaterial } from "@gatekeeper/offline";

// Generate once, store in your own secret manager, then pass it in on
// every startup — do NOT call generateHmacKeyMaterial() at every startup,
// or every previously issued token becomes unverifiable.
const signingKey = generateHmacKeyMaterial();

const gatekeeper = await createOfflineGateKeeper({ signingKey, siteId: "kiosk-1" });

const challenge = await gatekeeper.issue("login");
// ... render `challenge` with @gatekeeper/captcha-client's renderers, or
// your own UI, and collect the user's answer ...

const result = await gatekeeper.verify({
  challengeId: challenge.id,
  action: "login",
  signedEnvelope: challenge.signedEnvelope,
  answer: userAnswer,
  events: collectedInteractionEvents, // optional but improves risk scoring
});

if (result.success) {
  // Your OWN backend logic still calls verifyToken() before trusting it —
  // exactly like the online mode's server SDK, "never trust the client"
  // still applies (docs/THREAT_MODEL.md).
  const tokenResult = await gatekeeper.verifyToken(result.token!, "login");
  if (tokenResult.success) {
    // proceed with the login
  }
}
```
