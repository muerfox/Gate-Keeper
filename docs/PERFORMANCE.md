# Gate Keeper Performance Notes

Companion to `docs/ARCHITECTURE.md` §Performance notes. This document
records what was actually measured against a running instance, not just
theoretical design intent — including a real bottleneck found and fixed
during this work.

## Measurement setup

`tests/performance/load-test.mjs` drives `POST /api/v1/challenge` followed
by `POST /api/v1/verify` (with a deliberately wrong answer — this measures
request-handling latency through the full validate → consume → risk-score
→ respond path, not solve correctness) at a configurable concurrency for a
fixed duration, reporting p50/p95/p99 latency and approximate throughput.

```sh
docker compose up -d postgres redis api
npm run seed -w @gatekeeper/demo
GK_API_URL=http://localhost:8080 GK_SITE_KEY=<seeded public key> \
  node tests/performance/load-test.mjs
```

The numbers below were captured in this development sandbox (a
resource-constrained, single-shared-core container — not representative
of production-grade hardware) using an embedded ephemeral Postgres and an
in-memory Redis mock in place of a real Redis. Treat the *relative*
improvement as the meaningful result, not the absolute numbers, which will
differ on real infrastructure with a dedicated Postgres/Redis and more
CPU headroom.

## Finding: synchronous per-request config/domain lookups

Initial measurement (concurrency 20, 5s window): **p50 challenge latency
532ms, p50 verify latency 278ms**, with the majority of requests failing —
initially assumed to be a performance defect, but on inspection about
90% of "failures" were the per-IP rate limiter correctly rejecting
requests once the test's sustained concurrency exceeded the configured
60/min limit from a single source IP (expected and correct; see
docs/ARCHITECTURE.md's rate-limiting design). The latency itself, however,
was a real bottleneck.

Root cause: both `POST /api/v1/challenge` and `POST /api/v1/verify` were
doing two synchronous Prisma reads on every single request — the site's
registered domain list (for the Origin/Referer allow-list check) and its
`SiteConfig` row (for `computationalChallengesEnabled`) — before doing any
other work. Under concurrent load these queued on Prisma's connection
pool, and that queueing dominated total request latency.

Fix (`apps/api/src/site-meta.ts`, `apps/api/src/ttl-cache.ts`): both reads
are now combined into one cached lookup with a 5-second TTL, keyed by
`siteId`. The cache is explicitly invalidated when an admin updates a
site's config via `PATCH /api/v1/site/:id/config`, so operator changes
still propagate promptly in the common case; absent an explicit
invalidation, staleness is bounded to 5 seconds.

**This caching is deliberately NOT applied to API key resolution.** A
revoked secret or public key must stop authenticating immediately —
`apps/api/src/keys/site-keys.ts` still does a live database read on every
call. The 5-second staleness window is an accepted trade-off only for the
two specific low-security-sensitivity reads named above (see the comment
in `ttl-cache.ts` for the full reasoning).

Measurement after the fix (concurrency 5, 3s window, to stay under the
per-IP rate limit and isolate latency from rate-limit rejections):

| | Before | After |
|---|---|---|
| Challenge p50 | 533 ms | 74 ms |
| Verify p50 | 278 ms | 89 ms |
| Challenge p99 | 595 ms | 358 ms |

A ~4-7x reduction in median latency from one caching change, entirely
from removing redundant synchronous database round trips from the hot
path — consistent with docs/ARCHITECTURE.md's stated design goal of
"no synchronous DB write on the hot path for LOW-risk (invisible)
verifications" (this extends the same principle to reads).

## Other hot-path characteristics (by design, not separately benchmarked
here)

- **Signature verification** uses `jose`'s WebCrypto-backed Ed25519/HMAC
  implementations — no custom cryptography, and fast enough that it does
  not show up as a bottleneck relative to I/O.
- **Replay/rate-limit checks** are single Redis round trips (`SET NX EX`,
  or one Lua script for the sliding-window/token-bucket algorithms) — O(1)
  or O(log n), not a full table scan, and the dominant cost in a
  properly-provisioned deployment is network latency to Redis, not CPU.
- **Audit writes** (`Challenge` row on issuance, `VerificationAttempt` and
  `RiskEvent` rows on verification) are fire-and-forget (`.catch()`,
  never awaited) — a slow or degraded database cannot add latency to the
  security-critical decision path, only to how quickly analytics reflect
  reality.
- **Body size limits** (`MAX_REQUEST_BODY_BYTES`, 32 KiB) and schema
  validation run before any cryptographic or database work, so a
  malformed/oversized-request flood is cheap to reject (see
  docs/THREAT_MODEL.md §4.11).

## Known remaining limitations (not fixed in this pass)

- There is no endpoint to add/remove a domain on an existing site after
  creation (`POST /api/v1/sites` accepts a domain list only at creation
  time). Not a performance issue, but relevant to the caching discussion
  above: once such an endpoint exists, it must also call
  `ctx.siteMetaCache.invalidate(siteId)`.
- The `siteMetaCache` is per-process. A multi-instance deployment behind a
  load balancer has independent caches per instance; the 5-second
  staleness bound still holds per-instance, but a config change is not
  synchronized across instances faster than that. This is an acceptable
  trade for data that isn't security-enforcement-critical (unlike the
  Redis-backed rate limiting and replay protection, which are
  cross-instance-consistent by design).
- No formal load test against production-shaped infrastructure (real
  Postgres, real Redis, multiple CPU cores, realistic network latency)
  has been run — the numbers above establish that the fix works and by
  roughly what factor, not a production capacity figure. Before a real
  launch, run `tests/performance/load-test.mjs` (or a proper tool like k6)
  against a staging deployment sized like production.
