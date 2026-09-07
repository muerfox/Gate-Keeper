import { demoEnv } from "./env.js";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGateKeeperClient } from "@gatekeeper/captcha-server";
import { createOfflineGateKeeper, generateHmacKeyMaterial } from "@gatekeeper/offline";
import { layout } from "./layout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

// Serve the built browser SDK bundle so demo pages can
// <script src="/assets/gatekeeper.js">.
await app.register(fastifyStatic, {
  root: path.resolve(__dirname, "../../packages/captcha-client/dist"),
  prefix: "/assets/",
  decorateReply: false,
});

const backendClient = demoEnv.secretKey
  ? createGateKeeperClient({ secretKey: demoEnv.secretKey, apiUrl: demoEnv.apiUrl, onServiceUnavailable: "deny" })
  : null;

// Self-contained offline mode running in this same process — no
// Postgres/Redis, no call to apps/api. See docs/OFFLINE_MODE.md.
const offlineGateKeeper = await createOfflineGateKeeper({ signingKey: generateHmacKeyMaterial(), siteId: "demo-offline" });

function notConfiguredNotice(): string {
  return `<div class="card">
    <strong>Demo not fully configured.</strong>
    <p class="muted">This page needs a running Gate Keeper API and a seeded demo site key. From the repo root:</p>
    <pre>docker compose up -d postgres redis api
npm run seed -w @gatekeeper/demo
npm run dev -w @gatekeeper/demo</pre>
  </div>`;
}

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(
    layout(
      "Overview",
      `<h1>Gate Keeper</h1>
      <p class="subtitle">A smarter gate between humans and automated abuse. This demo exercises the real, running Gate Keeper API — nothing here is mocked.</p>

      <div class="grid">
        <div class="card">
          <h3>Normal verification</h3>
          <p class="muted">A typical low-risk visitor. The widget is invisible-to-light-friction; your backend independently re-verifies the token.</p>
          <a class="btn" href="/signup">Try it →</a>
        </div>
        <div class="card">
          <h3>Bot simulation</h3>
          <p class="muted">Scripts the API directly with implausible timing — see the risk engine react in real time.</p>
          <a class="btn" href="/suspicious">Try it →</a>
        </div>
        <div class="card">
          <h3>Accessibility mode</h3>
          <p class="muted">The keyboard/screen-reader-first challenge path, requested explicitly.</p>
          <a class="btn" href="/accessible">Try it →</a>
        </div>
        <div class="card">
          <h3>Offline mode</h3>
          <p class="muted">Issuing and verifying challenges entirely in this process — no network call, no database.</p>
          <a class="btn" href="/offline">Try it →</a>
        </div>
      </div>

      <div class="card">
        <h3>Admin dashboard</h3>
        <p class="muted">Sites, keys, verification events, risk analytics, and audit logs for this demo account.</p>
        <a class="btn" href="${demoEnv.dashboardUrl}" target="_blank" rel="noopener">Open dashboard →</a>
      </div>

      <div class="card">
        <h3>API verification</h3>
        <p class="muted">How a backend independently trusts a verification — see <a href="/api-demo">API verification</a> for the code.</p>
      </div>
      `,
      "/",
    ),
  );
});

app.get("/signup", async (_req, reply) => {
  if (!demoEnv.siteKey) return reply.type("text/html").send(layout("Normal verification", notConfiguredNotice(), "/signup"));

  reply.type("text/html").send(
    layout(
      "Normal verification",
      `<h1>Normal verification</h1>
      <p class="subtitle">The widget requests a challenge, the server-side risk engine decides how much friction to apply, and this page's own backend independently re-verifies the resulting token before "creating" an account.</p>
      <div class="card">
        <div id="gatekeeper"></div>
        <br/>
        <button class="btn" id="submit-btn" disabled>Create account</button>
        <div class="result-box" id="result">Waiting for verification…</div>
      </div>
      <script src="/assets/gatekeeper.js"></script>
      <script>
        let token = null;
        GateKeeper.render('#gatekeeper', {
          siteKey: ${JSON.stringify(demoEnv.siteKey)},
          apiUrl: ${JSON.stringify(demoEnv.apiUrl)},
          action: 'signup',
          onSuccess(t) {
            token = t;
            document.getElementById('submit-btn').disabled = false;
            document.getElementById('result').textContent = 'Client-side check passed. Click "Create account" to have the backend verify it.';
          },
          onFailure(e) {
            document.getElementById('result').textContent = 'Verification failed: ' + e.code;
          }
        });
        document.getElementById('submit-btn').addEventListener('click', async () => {
          const res = await fetch('/api/demo/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, action: 'signup' }) });
          document.getElementById('result').textContent = JSON.stringify(await res.json(), null, 2);
        });
      </script>`,
      "/signup",
    ),
  );
});

app.get("/accessible", async (_req, reply) => {
  if (!demoEnv.siteKey) return reply.type("text/html").send(layout("Accessibility mode", notConfiguredNotice(), "/accessible"));

  reply.type("text/html").send(
    layout(
      "Accessibility mode",
      `<h1>Accessibility mode</h1>
      <p class="subtitle">This uses the HTML data-attribute widget (no JavaScript integration code required) with the accessible challenge path requested explicitly — fully keyboard- and screen-reader-operable, per docs/ACCESSIBILITY.md.</p>
      <div class="card">
        <div data-gatekeeper data-site-key="${demoEnv.siteKey}" data-api-url="${demoEnv.apiUrl}" data-action="login" data-accessible="true" data-callback="onGkSuccess" data-error-callback="onGkFailure"></div>
        <div class="result-box" id="result">Waiting for verification…</div>
      </div>
      <script src="/assets/gatekeeper.js"></script>
      <script>
        function onGkSuccess(token) { document.getElementById('result').textContent = 'Success. Token: ' + token; }
        function onGkFailure(error) { document.getElementById('result').textContent = 'Failed: ' + error.code; }
      </script>`,
      "/accessible",
    ),
  );
});

app.get("/suspicious", async (_req, reply) => {
  if (!demoEnv.siteKey) return reply.type("text/html").send(layout("Bot simulation", notConfiguredNotice(), "/suspicious"));

  reply.type("text/html").send(
    layout(
      "Bot simulation",
      `<h1>Bot simulation</h1>
      <p class="subtitle">This calls the API directly — skipping the widget entirely, the way a scripted attacker would — and answers instantly with a guessed value and no interaction events. Watch the risk level and outcome the server returns.</p>
      <div class="card">
        <button class="btn" id="run">Run bot simulation</button>
        <div class="result-box" id="result">Not run yet.</div>
      </div>
      <script>
        document.getElementById('run').addEventListener('click', async () => {
          const result = document.getElementById('result');
          result.textContent = 'Requesting challenge…';
          const challengeRes = await fetch(${JSON.stringify(demoEnv.apiUrl)} + '/api/v1/challenge', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ siteKey: ${JSON.stringify(demoEnv.siteKey)}, action: 'signup' })
          });
          const challenge = await challengeRes.json();

          // A real bot: no rendering, no delay, no pointer/keyboard events,
          // just an instant guess.
          const verifyRes = await fetch(${JSON.stringify(demoEnv.apiUrl)} + '/api/v1/verify', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ siteKey: ${JSON.stringify(demoEnv.siteKey)}, action: 'signup', challengeId: challenge.id, signedEnvelope: challenge.signedEnvelope, answer: 'guessed-answer', events: [] })
          });
          const verify = await verifyRes.json();
          result.textContent = 'Challenge type: ' + challenge.type + ' (difficulty ' + challenge.difficulty + ')\\n\\n' + JSON.stringify(verify, null, 2);
        });
      </script>`,
      "/suspicious",
    ),
  );
});

app.get("/offline", async (_req, reply) => {
  reply.type("text/html").send(
    layout(
      "Offline mode",
      `<h1>Offline mode</h1>
      <p class="subtitle">This widget talks to <code>/offline-api</code> on this same demo server — a self-contained @gatekeeper/offline instance with no Postgres, no Redis, and no call to apps/api. See docs/OFFLINE_MODE.md for what this trades away.</p>
      <div class="card">
        <div id="gatekeeper"></div>
        <div class="result-box" id="result">Waiting for verification…</div>
      </div>
      <script src="/assets/gatekeeper.js"></script>
      <script>
        GateKeeper.render('#gatekeeper', {
          siteKey: 'offline-demo',
          apiUrl: '/offline-api',
          action: 'login',
          onSuccess(t) { document.getElementById('result').textContent = 'Success (offline). Token: ' + t; },
          onFailure(e) { document.getElementById('result').textContent = 'Failed: ' + e.code; }
        });
      </script>`,
      "/offline",
    ),
  );
});

app.get("/api-demo", async (_req, reply) => {
  reply.type("text/html").send(
    layout(
      "API verification",
      `<h1>API verification</h1>
      <p class="subtitle">Every demo page above that mints a token still has its backend independently verify it — this is that call. A client-reported "success" is never trusted on its own (docs/THREAT_MODEL.md).</p>
      <pre><code>import { createGateKeeperClient } from "@gatekeeper/captcha-server";

const gatekeeper = createGateKeeperClient({
  secretKey: process.env.GATEKEEPER_SECRET_KEY,
});

const result = await gatekeeper.verify({ token, action: "signup" });
if (!result.success) {
  return res.status(403).json({ error: "verification_failed" });
}</code></pre>
      <p class="muted">This demo server's own <code>POST /api/demo/verify</code> route (used by the Normal verification page) is exactly this code — see apps/demo/server.ts.</p>`,
      "/api-demo",
    ),
  );
});

app.post("/api/demo/verify", async (request, reply) => {
  if (!backendClient) return reply.code(503).send({ error: "demo_not_configured" });
  const body = request.body as { token?: string; action?: string };
  if (!body.token || !body.action) return reply.code(400).send({ error: "invalid_request" });

  const result = await backendClient.verify({ token: body.token, action: body.action });
  return reply.send(result);
});

// --- Offline-mode API, backed entirely by @gatekeeper/offline ----------
app.post("/offline-api/v1/challenge", async (request, reply) => {
  const body = request.body as { action: string; accessible?: boolean };
  const challenge = await offlineGateKeeper.issue(body.action, { accessible: body.accessible });
  return reply.send(challenge);
});

app.post("/offline-api/v1/verify", async (request, reply) => {
  const body = request.body as { action: string; challengeId: string; signedEnvelope: string; answer: unknown; events?: unknown[] };
  const result = await offlineGateKeeper.verify({
    challengeId: body.challengeId,
    action: body.action,
    signedEnvelope: body.signedEnvelope,
    answer: body.answer,
    events: body.events as never,
  });
  return reply.send(result);
});

await app.listen({ port: demoEnv.port, host: "0.0.0.0" });
console.log(`Gate Keeper demo running at http://localhost:${demoEnv.port}`);
if (!demoEnv.siteKey) {
  console.log(`Run "npm run seed -w @gatekeeper/demo" (with the API's Postgres reachable) to enable the online-mode demos.`);
}
