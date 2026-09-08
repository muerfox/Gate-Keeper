import { testEnv } from "./env.js";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGateKeeperClient } from "@gatekeeper/captcha-server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This page exists only to prove a Gate Keeper deployment actually works
// end to end — it is not a real auth system. Anyone who reads the source
// (or this comment) knows the password.
const TEST_USERNAME = "demo";
const TEST_PASSWORD = "gatekeeper-test";

const app = Fastify({ logger: true });

await app.register(fastifyStatic, {
  root: path.resolve(__dirname, "../../packages/captcha-client/dist"),
  prefix: "/assets/",
  decorateReply: false,
});

const backendClient = testEnv.secretKey
  ? createGateKeeperClient({ secretKey: testEnv.secretKey, apiUrl: testEnv.apiUrl, onServiceUnavailable: "deny" })
  : null;

function page(): string {
  if (!testEnv.siteKey) {
    return `<!doctype html><html><body style="font-family:sans-serif;max-width:520px;margin:80px auto;line-height:1.5">
      <h1>Not seeded yet</h1>
      <p>The test site/keys haven't been provisioned. If you just ran
      <code>docker compose -f docker-compose.test.yml up</code>, wait a few
      seconds for the <code>test-login</code> container to finish seeding
      and reload this page.</p>
    </body></html>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Gate Keeper — test login</title>
<style>
  :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { max-width: 420px; margin: 60px auto; padding: 0 20px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .muted { color: #6b7280; font-size: 13px; margin-top: 0; }
  .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 24px; margin-top: 20px; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; margin-top: 14px; }
  input { width: 100%; padding: 9px 10px; border-radius: 8px; border: 1px solid #d1d5db; font-size: 14px; box-sizing: border-box; }
  button { border: none; border-radius: 8px; padding: 10px 16px; font-weight: 600; font-size: 14px; cursor: pointer; margin-top: 16px; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-primary:disabled { background: #93a5c9; cursor: not-allowed; }
  .btn-secondary { background: #fff; border: 1px solid #d1d5db; margin-left: 8px; }
  .result { font-family: ui-monospace, monospace; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; border-radius: 8px; padding: 12px; margin-top: 16px; }
  .result.pending { background: #f3f4f6; }
  .result.pass { background: #dcfce7; color: #14532d; }
  .result.fail { background: #fee2e2; color: #7f1d1d; }
  .hint { font-size: 12px; color: #6b7280; }
</style>
</head>
<body>
  <h1>Gate Keeper — test login</h1>
  <p class="muted">This page verifies a real Gate Keeper deployment end to end: the widget below talks to the live API (${testEnv.apiUrl}), and this server independently re-verifies the resulting token before checking your credentials. Nothing here is mocked.</p>

  <div class="card">
    <p class="hint">Demo credentials: <code>${TEST_USERNAME}</code> / <code>${TEST_PASSWORD}</code></p>
    <label for="username">Username</label>
    <input id="username" value="${TEST_USERNAME}" autocomplete="username" />
    <label for="password">Password</label>
    <input id="password" type="password" value="${TEST_PASSWORD}" autocomplete="current-password" />

    <div id="gatekeeper" style="margin-top:16px"></div>

    <button class="btn-primary" id="login-btn" disabled>Log in</button>
    <button class="btn-secondary" id="bot-btn" type="button">Simulate bot (skip CAPTCHA)</button>

    <div class="result pending" id="result">Solve the challenge above to enable login.</div>
  </div>

  <script src="/assets/gatekeeper.js"></script>
  <script>
    let token = null;
    const result = document.getElementById('result');
    const loginBtn = document.getElementById('login-btn');

    function setResult(state, text) {
      result.className = 'result ' + state;
      result.textContent = text;
    }

    GateKeeper.render('#gatekeeper', {
      siteKey: ${JSON.stringify(testEnv.siteKey)},
      apiUrl: ${JSON.stringify(testEnv.apiUrl)},
      action: 'login',
      onSuccess(t) {
        token = t;
        loginBtn.disabled = false;
        setResult('pending', 'Challenge solved. Click "Log in" to have the server independently re-verify it.');
      },
      onFailure(e) {
        token = null;
        loginBtn.disabled = true;
        setResult('fail', 'Widget-side verification failed: ' + e.code);
      }
    });

    async function submitLogin(body) {
      setResult('pending', 'Checking with the server…');
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResult(data.ok ? 'pass' : 'fail', JSON.stringify(data, null, 2));
    }

    loginBtn.addEventListener('click', () => submitLogin({
      username: document.getElementById('username').value,
      password: document.getElementById('password').value,
      token,
    }));

    document.getElementById('bot-btn').addEventListener('click', () => submitLogin({
      username: document.getElementById('username').value,
      password: document.getElementById('password').value,
      token: null,
    }));
  </script>
</body>
</html>`;
}

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(page());
});

app.get("/healthz", async () => ({ ok: true }));

app.post("/login", async (request, reply) => {
  const body = request.body as { username?: string; password?: string; token?: string | null };

  if (!backendClient) {
    return reply.code(503).send({ ok: false, stage: "config", message: "Test site not seeded yet — wait a few seconds and reload the page." });
  }

  if (!body.token) {
    return reply.code(401).send({
      ok: false,
      stage: "captcha",
      message: "No verification token was presented, so the server rejected this request before even looking at the username/password. This is the check a scripted login attempt would hit.",
    });
  }

  const verification = await backendClient.verify({ token: body.token, action: "login" });
  if (!verification.success) {
    return reply.code(403).send({
      ok: false,
      stage: "captcha",
      message: "The server independently re-verified this token against the real Gate Keeper API and rejected it.",
      detail: verification,
    });
  }

  if (body.username !== TEST_USERNAME || body.password !== TEST_PASSWORD) {
    return reply.code(401).send({ ok: false, stage: "credentials", message: "Gate Keeper verification passed, but the username or password was wrong." });
  }

  return reply.send({
    ok: true,
    stage: "done",
    message: "Logged in. The server independently re-verified this token against the real Gate Keeper API before your credentials were even checked.",
    detail: verification,
  });
});

await app.listen({ port: testEnv.port, host: "0.0.0.0" });
console.log(`Gate Keeper test login running at http://localhost:${testEnv.port}`);
if (!testEnv.siteKey) {
  console.log(`Waiting for scripts/seed-test.ts to provision a site — this normally runs automatically at container start.`);
}
