# Gate Keeper Architecture

Companion to `docs/THREAT_MODEL.md`. This document describes *how* Gate Keeper is built; the
threat model describes *why*.

## Design principle

> Easy for humans, expensive for bots.

Gate Keeper does not try to win by making a single puzzle unsolvable. It wins by making
large-scale automation defeat several independent systems at once, continuously, at a cost that
exceeds the value of the abuse. Each layer below is designed to degrade gracefully: if one layer
is bypassed or fails, the others still constrain the attacker.

## Layered architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 1  Client integrity & orchestration   (packages/captcha-client)│
│   Loads widget, requests a challenge, renders UI, collects raw       │
│   interaction events, submits response. Zero trust: nothing here is  │
│   a security boundary.                                               │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 2  Cryptographic challenge/response   (packages/crypto,        │
│   Signed, nonce'd, expiring challenges. Server-verifiable answers.   │
│   packages/challenges)                                                │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 3  Behavioral consistency analysis    (packages/risk-engine)   │
│   Cross-checks event streams for internal consistency, not presence. │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 4  Server-side risk engine            (packages/risk-engine)   │
│   Combines signals into LOW/MEDIUM/HIGH/CRITICAL. Client can never   │
│   submit its own score.                                              │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 5  Rate limiting & abuse prevention   (packages/rate-limit)    │
│   Token bucket + sliding window, composite keys, Redis-backed.       │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 6  Token validation & replay          (packages/crypto,        │
│   protection                                 apps/api)                │
│   Atomic one-time consumption, expiry, site/action binding.          │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 7  Adaptive challenge escalation      (apps/api risk pipeline) │
│   Risk level selects: allow / light challenge / hard challenge /     │
│   block.                                                             │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 8  Reputation & telemetry (optional)  (apps/api, dashboard)    │
│   Aggregate abuse signals across sites/actions; privacy-configurable.│
└─────────────────────────────────────────────────────────────────────┘
```

A failure or bypass at Layer 1 or 3 (client-side, inherently attacker-controlled) still leaves
Layers 2, 5, 6 fully intact because they never depend on client honesty. A Redis outage degrades
Layer 5/6 to a documented fallback (§Failure Modes) rather than silently disabling them.

## Request flow

```
Browser widget                 Gate Keeper API                  Customer backend
──────────────                 ────────────────                 ─────────────────
render()/execute()
      │
      ├──POST /api/v1/challenge──▶ validate site key + origin
      │                            check issuance rate limits (L5)
      │                            pick challenge type (L7, from
      │                              current session risk signal)
      │                            generate challenge (L2):
      │                              random id + nonce, sign, TTL
      │                            store challenge state (Redis)
      │◀────challenge payload──────
      │
   render challenge UI
   collect interaction events (L1)
      │
      ├──POST /api/v1/verify───────▶ validate size/schema
      │  (challenge answer +          verify signature + expiry (L2)
      │   raw interaction events)     atomically consume challenge (L6)
      │                               run behavioral consistency (L3)
      │                               run risk engine (L4) → level
      │                               apply rate limits (L5)
      │                               decide: pass / harder challenge /
      │                                 block
      │◀────signed result token────── if pass: mint short-lived,
      │     (or escalation payload)    site+action-bound token (L2/L6)
      │
   onSuccess(token) / onFailure(err)
      │
      │  token handed to site's own form/JS
      ▼
                                                          POST checkout/signup/...
                                                          (token included)
                                                                  │
                                                                  ├──gatekeeper.verify({token, action})
                                                                  │  via secret server key ─────────▶
                                                                  │                            atomically
                                                                  │                            CONSUME token
                                                                  │                            (single use,
                                                                  │                             L6) + check
                                                                  │                            site/action bind
                                                                  │◀────{success, risk, ...}────
                                                                  │
                                                          allow/deny the real action
```

The customer backend call to `gatekeeper.verify` is what actually consumes the token. This means
a token can be minted by `/verify` (client-facing) as "passed" but is only *spent* once, at the
customer's own server, closing the loop against token replay/farming between the widget and the
protected action.

## Challenge structure

Every challenge issued by Layer 2 contains:

| Field | Purpose |
|---|---|
| `id` | Cryptographically random (128-bit) challenge identifier |
| `nonce` | Cryptographically random (128-bit) single-use value, independent of `id` |
| `type` | Challenge category (see `packages/challenges`) |
| `difficulty` | 1-5, chosen by the risk/escalation pipeline |
| `siteId` | Binds the challenge to one registered site |
| `action` | Binds the challenge to one declared action string |
| `issuedAt` / `expiresAt` | Unix ms timestamps; short TTL (default 90s, configurable) |
| `payload` | Type-specific public data needed to render the challenge (never the answer) |
| `answerHash` | Salted hash of the expected answer(s), server-side only, never sent to the client |
| `signature` | Ed25519 (or HMAC-SHA256 in symmetric mode) signature over the canonical challenge fields |

The client never receives `answerHash` or the signing key. The signature lets any Gate Keeper
node verify the challenge was genuinely issued (and not tampered with) without a DB round trip,
at verify time — the DB/Redis lookup is still required for **replay** state, but not for
**authenticity**.

## Token structure

A verification token is a signed, compact structure (implemented as a JWT-like JOSE token via the
`jose` library) with claims:

```jsonc
{
  "sub": "gk_token",
  "cid": "<challenge id that produced this token>",
  "sid": "<site id>",
  "act": "signup",              // action binding
  "iat": 1730000000,
  "exp": 1730000120,             // short-lived, default 120s
  "jti": "<unique nonce>",       // replay key
  "risk": "LOW",                 // risk level at issuance time, informational for the customer
  "env": "production"           // dev/production key scope
}
```

Signed with Ed25519 (asymmetric — allows a customer's server SDK to optionally verify locally
against a published public key without a network call, while only Gate Keeper's signing service
holds the private key) or HMAC-SHA256 in fully self-hosted symmetric deployments. Verification
always additionally checks the token against the replay store (`jti` must not have been consumed)
— signature validity alone is necessary but not sufficient, since a *stolen but unexpired,
unconsumed* valid token must still fail on second use.

## Replay Protection — atomicity guarantee

The core invariant: **exactly one** verification attempt for a given challenge/token nonce may
succeed; all concurrent or later attempts must fail, even under parallel/simultaneous submission.

Primary store: Redis.

```lua
-- consume.lua (executed atomically by Redis; single-threaded execution model
-- means no other command can interleave between the check and the write)
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local existing = redis.call('SET', key, '1', 'NX', 'EX', ttl)
if existing then
  return 1   -- this caller wins, first consumption
else
  return 0   -- already consumed by someone else
end
```

`SET key val NX EX ttl` is itself atomic in Redis (single command, single event-loop tick), so no
Lua script is strictly required for the simple case — it's shown here because the production
implementation extends it to also record consumption metadata (timestamp, consumer IP) in the
same atomic step via a small Lua script, so that "who consumed it" is captured without a second
round trip that could itself race.

Fallback store: PostgreSQL, using a unique constraint on `consumed_tokens(jti)` plus
`INSERT ... ON CONFLICT DO NOTHING` — also atomic at the database level, and used automatically if
Redis is unavailable (see Failure Modes) or in offline mode where Redis may not be deployed.

Distributed correctness: because Redis commands are serialized per key (single Redis instance or
single Redis Cluster hash slot), two concurrent requests hitting different API nodes still
serialize correctly at the Redis layer — there is no node-local cache of "is this token
consumed" that could go stale and allow double-spend.

## Risk Engine output contract

The risk engine (Layer 4) is the **only** source of a risk level used in decisions. It:

- Never accepts a client-submitted score as input to itself.
- Consumes only server-observed signals (arrival timing, request velocity, challenge history,
  behavioral consistency score from Layer 3, optional IP reputation) — see
  `packages/risk-engine/README.md` for the full input list.
- Outputs exactly one of `LOW | MEDIUM | HIGH | CRITICAL`.
- Is deterministic given its inputs (no hidden randomness) so outcomes are auditable, though the
  *challenge chosen* in response to a level can include randomized selection among an equally
  appropriate set.

Decision mapping (defaults, admin-configurable per site):

| Risk | Action |
|---|---|
| LOW | Allow, issue token immediately (invisible) |
| MEDIUM | Issue one interactive challenge |
| HIGH | Issue a harder challenge, or two sequential challenges |
| CRITICAL | Block / heavy throttle, log security event |

## Failure Modes

| Dependency down | Fail-open (configurable) | Fail-closed (configurable, default) |
|---|---|---|
| Redis (rate limit + replay) | Requests proceed; DB-backed unique constraint still enforces one-time token use (slower, but correct); rate limiting degrades to a coarser DB-approximated limit. Security event logged as `redis_degraded`. | New challenge issuance and verification are refused with `503 service_degraded` until Redis recovers. |
| PostgreSQL (config/audit/analytics) | Verification can continue using cached site/key config (short TTL, e.g. 60s) and Redis-only replay protection; writes (audit log, analytics) are queued/best-effort. Security event logged as `db_degraded`. | Verification refused with `503 service_degraded`. |
| Gate Keeper API unreachable (from customer's POV) | Customer's server SDK exposes an explicit `onServiceUnavailable` policy the integrator sets in advance: `allow`, `deny`, or `queue-and-retry`. There is no silent default — an unconfigured policy defaults to `deny` (safer default) and logs a warning. | (same knob) |

In every degraded case the system logs a security event tagged with the degraded dependency and
the policy applied — degradation is never silent. Administrators pick fail-open vs. fail-closed
per environment because the "safe" choice depends on the customer's own risk tolerance (an
e-commerce checkout may prefer fail-open over blocking all sales; a account-creation endpoint may
prefer fail-closed).

## Performance notes

- Challenge generation and token verification are pure-CPU + single Redis round trip — no
  synchronous DB write on the hot path for LOW-risk (invisible) verifications; audit/analytics
  writes are enqueued and flushed asynchronously in batches.
  - Signature operations use Ed25519 (fast verify, ~50-100k ops/sec/core) via `jose`'s WebCrypto
   bindings, avoiding hand-rolled crypto and its performance/security pitfalls alike.
- Postgres writes are batched/async for analytics-only data; synchronous writes are limited to
  the state that must be immediately consistent (token consumption fallback, audit log for
  privileged actions).
- Rate limit counters use Redis `INCR`/sorted-set sliding-window scripts (O(log n) per check),
  not per-request full table scans.

## Monorepo layout

See root `README.md` for the up-to-date tree; packages are split so that a security review of
`packages/crypto` (the highest-value target) does not require reading dashboard or SDK code.
