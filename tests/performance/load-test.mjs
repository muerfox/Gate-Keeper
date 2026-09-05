#!/usr/bin/env node
/**
 * Lightweight throughput check for the verification API's hot path
 * (POST /api/v1/challenge, POST /api/v1/verify), per docs/ARCHITECTURE.md
 * §Performance notes. This is a smoke-level load generator, not a
 * substitute for a proper load-testing setup (k6, Gatling) against a
 * production-sized deployment — it exists so a contributor can sanity-check
 * that a change hasn't introduced an obvious latency regression.
 *
 * Usage:
 *   1. Start Postgres + Redis + the API (docker compose up -d postgres redis api)
 *   2. node apps/demo/scripts/seed-demo.js   (or run the seed via tsx)
 *   3. GK_SITE_KEY=... GK_API_URL=http://localhost:8080 node tests/performance/load-test.mjs
 */
const apiUrl = process.env.GK_API_URL ?? "http://localhost:8080";
const siteKey = process.env.GK_SITE_KEY;
const concurrency = Number(process.env.GK_LOAD_CONCURRENCY ?? 20);
const durationMs = Number(process.env.GK_LOAD_DURATION_MS ?? 5000);

if (!siteKey) {
  console.error("Set GK_SITE_KEY to a seeded public site key (see apps/demo/scripts/seed-demo.ts).");
  process.exit(1);
}

async function issueAndFailOnePass() {
  const start = performance.now();
  const challengeRes = await fetch(`${apiUrl}/api/v1/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteKey, action: "load-test" }),
  });
  const challenge = await challengeRes.json();
  const challengeMs = performance.now() - start;

  const verifyStart = performance.now();
  const verifyRes = await fetch(`${apiUrl}/api/v1/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      siteKey,
      action: "load-test",
      challengeId: challenge.id,
      signedEnvelope: challenge.signedEnvelope,
      // Deliberately wrong — this script measures request handling
      // latency, not solve correctness, and a wrong answer still
      // exercises the full validate -> consume -> risk-score -> respond
      // path.
      answer: "load-test-answer",
      events: [],
    }),
  });
  await verifyRes.json();
  const verifyMs = performance.now() - verifyStart;

  return { challengeMs, verifyMs, ok: challengeRes.ok && verifyRes.ok };
}

async function worker(results, deadline) {
  while (performance.now() < deadline) {
    try {
      results.push(await issueAndFailOnePass());
    } catch (err) {
      results.push({ error: String(err) });
    }
  }
}

function percentile(sorted, p) {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

const results = [];
const deadline = performance.now() + durationMs;
await Promise.all(Array.from({ length: concurrency }, () => worker(results, deadline)));

const ok = results.filter((r) => r.ok);
const errors = results.filter((r) => r.error || !r.ok);
const challengeLatencies = ok.map((r) => r.challengeMs).sort((a, b) => a - b);
const verifyLatencies = ok.map((r) => r.verifyMs).sort((a, b) => a - b);

console.log(`Requests: ${results.length} (${ok.length} ok, ${errors.length} errors) over ${durationMs}ms at concurrency ${concurrency}`);
console.log(`Approx throughput: ${(ok.length / (durationMs / 1000)).toFixed(1)} full challenge+verify round-trips/sec`);
console.log(`Challenge latency (ms): p50=${percentile(challengeLatencies, 0.5)?.toFixed(1)} p95=${percentile(challengeLatencies, 0.95)?.toFixed(1)} p99=${percentile(challengeLatencies, 0.99)?.toFixed(1)}`);
console.log(`Verify latency (ms):    p50=${percentile(verifyLatencies, 0.5)?.toFixed(1)} p95=${percentile(verifyLatencies, 0.95)?.toFixed(1)} p99=${percentile(verifyLatencies, 0.99)?.toFixed(1)}`);
if (errors.length > 0) {
  console.log("Sample errors:", errors.slice(0, 3));
}
