# Gate Keeper

**A smarter gate between humans and automated abuse.**

Gate Keeper is a CAPTCHA and anti-bot platform: a widget/API pair for
websites, an admin dashboard, and support for both a hosted/self-hosted
online mode and a fully offline mode. It does not claim any single
challenge is unbreakable — it makes large-scale automation expensive by
combining independent layers of defense. Read `docs/THREAT_MODEL.md`
before anything else if you're evaluating this for production use.

## What's in this repository

```
apps/
  api/         Verification API (Fastify) — the security-critical service
  dashboard/   Admin dashboard (React) — sites, keys, analytics, audit logs
  demo/        A working demo site exercising the real API

packages/
  crypto/           Signed tokens/challenges, password hashing (no invented crypto)
  challenges/       The dynamic, modular challenge engine (11 categories)
  risk-engine/      Behavioral consistency analysis + risk scoring
  rate-limit/       Redis-backed rate limiting + atomic replay protection
  shared/           Zod schemas, shared types, Prisma schema
  captcha-client/   Browser SDK + widget (GateKeeper.render/execute)
  captcha-server/   Backend SDK (createGateKeeperClient(...).verify(...))
  react/            <GateKeeperCaptcha /> + useGateKeeper()
  vue/              <GateKeeperCaptcha /> + useGateKeeper()
  offline/          Self-hosted/offline local issuance+verification

infrastructure/     Docker Compose, Dockerfiles, Postgres/Redis config
tests/
  security/         Adversarial tests against the live API
  integration/      Full-stack tests (real ephemeral Postgres + Redis mock)
  performance/      A small load-test script
docs/               Architecture, threat model, security, privacy,
                    accessibility, offline mode, and API reference
```

## Quick start (local development)

Requires Node.js 20+. This monorepo uses npm workspaces.

```sh
npm install
npm run build   # builds every package once, in dependency order
```

Generate a signing key and an at-rest encryption key (do this once; store
the output somewhere safe — an env var, a secret manager — never commit
it):

```sh
node -e "import('@gatekeeper/crypto').then(async m => {
  console.log('GATEKEEPER_SIGNING_KEY=' + await m.generateEd25519KeyMaterial());
  console.log('GATEKEEPER_ENCRYPTION_KEY=' + m.generateEncryptionKey());
})"
```

### Option A — Docker Compose (Postgres + Redis + API + dashboard)

```sh
cp .env.example .env   # see below for what to fill in
docker compose up -d
npm run seed -w @gatekeeper/demo   # provisions a demo site/keys + admin login
npm run dev -w @gatekeeper/demo    # http://localhost:3100
```

`.env` (referenced by `docker-compose.yml`):
```
POSTGRES_PASSWORD=choose-a-real-password
GATEKEEPER_SIGNING_KEY=<from the command above>
GATEKEEPER_REDIS_FAILURE_POLICY=fail_closed
```

Then open:
- Demo: http://localhost:3100
- Dashboard: http://localhost:5173 (log in with the credentials the seed
  script printed)
- API: http://localhost:8080/healthz

### Option B — Run services individually (no Docker)

You'll need your own Postgres and Redis reachable via `DATABASE_URL` /
`REDIS_URL`.

```sh
export DATABASE_URL=postgres://user:pass@localhost:5432/gatekeeper
export REDIS_URL=redis://localhost:6379
export GATEKEEPER_SIGNING_KEY=...
export GATEKEEPER_ENCRYPTION_KEY=...

npm run db:generate
npx prisma db push --schema packages/shared/prisma/schema.prisma

npm run dev -w @gatekeeper/api         # http://localhost:8080
npm run dev -w @gatekeeper/dashboard   # http://localhost:5173
```

### Option C — Offline mode (no Postgres, no Redis, no network)

For intranets, air-gapped systems, or a quick local trial. **Read
`docs/OFFLINE_MODE.md` first — this mode trades away real security
properties online mode has.**

```ts
import { createOfflineGateKeeper, generateHmacKeyMaterial } from "@gatekeeper/offline";

const gatekeeper = await createOfflineGateKeeper({ signingKey: generateHmacKeyMaterial() });
const challenge = await gatekeeper.issue("login");
// render `challenge` with @gatekeeper/captcha-client's renderers, collect the answer
const result = await gatekeeper.verify({ challengeId: challenge.id, action: "login", signedEnvelope: challenge.signedEnvelope, answer });
```

`apps/demo`'s `/offline` page is a complete, running example of this.

## Integrating Gate Keeper into your site

### HTML widget (no build step)
```html
<div data-gatekeeper data-site-key="GK_PUBLIC_KEY" data-action="signup"></div>
<script src="https://your-gatekeeper-origin/assets/gatekeeper.js"></script>
```

### JavaScript
```js
GateKeeper.render("#gatekeeper", {
  siteKey: "GK_PUBLIC_KEY",
  action: "signup",
  onSuccess(token) { /* send token to your backend */ },
  onFailure(error) { console.error(error); },
});

// or, for an imperative flow (e.g. a login button handler):
const token = await GateKeeper.execute({ siteKey: "GK_PUBLIC_KEY", action: "login" });
```

### React
```tsx
import { GateKeeperCaptcha } from "@gatekeeper/react";

<GateKeeperCaptcha siteKey="GK_PUBLIC_KEY" action="signup" onSuccess={(token) => submit(token)} />
```

### Vue
```vue
<GateKeeperCaptcha site-key="GK_PUBLIC_KEY" action="signup" @success="onSuccess" />
```

### Backend verification — always required, never optional
```ts
import { createGateKeeperClient } from "@gatekeeper/captcha-server";

const gatekeeper = createGateKeeperClient({ secretKey: process.env.GATEKEEPER_SECRET_KEY! });
const result = await gatekeeper.verify({ token, action: "signup" });
if (!result.success) {
  return res.status(403).json({ error: "verification_failed" });
}
```

**A client-reported success is never sufficient on its own.** See
`docs/THREAT_MODEL.md`.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the layered design, request flow, replay protection guarantee
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — attacker capabilities, assets, mitigations, explicit non-goals
- [`docs/SECURITY.md`](docs/SECURITY.md) — key management, admin security, headers, CORS/CSRF posture
- [`docs/PRIVACY.md`](docs/PRIVACY.md) — full data inventory, retention, configuration
- [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) — WCAG-oriented design, keyboard/screen-reader support
- [`docs/OFFLINE_MODE.md`](docs/OFFLINE_MODE.md) — what offline mode does and does not preserve
- [`docs/API.md`](docs/API.md) / [`docs/openapi.yaml`](docs/openapi.yaml) — full endpoint reference
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — measured hot-path performance and a fixed bottleneck
- [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — a penetration-test-style review of this codebase

## Testing

```sh
npm test              # everything: unit + integration + security
npx vitest run packages           # unit tests only
npx vitest run tests/integration  # full-stack tests (spins up an ephemeral
                                   # real Postgres via `embedded-postgres` —
                                   # no Docker/root required — + an in-memory
                                   # Redis mock)
npx vitest run tests/security     # adversarial tests against the live API
```

## Troubleshooting

- **"GATEKEEPER_SIGNING_KEY is not set"** — generate one (see Quick Start)
  and export it; Gate Keeper refuses to start with an implicit default.
- **Domain mismatch (`403 domain_not_allowed`) on your own site** —
  register your site's exact hostname(s) via the dashboard's Sites page,
  or leave a site's domain list empty during local development only.
- **A verification always returns `RISK_BLOCKED` in development** — check
  your site's `criticalAction` config and whether you're triggering the
  behavioral-consistency checks by testing with a headless browser or
  scripted requests (which is, correctly, what those checks are designed
  to flag).
- **Dashboard shows no sites/data** — confirm `VITE_GATEKEEPER_API_URL`
  points at your running API and that you've run the seed script or
  created a site via the dashboard itself.
- **Tests are slow to start** — the integration/security suites boot a
  real ephemeral Postgres per test file (a few seconds each); this is
  intentional (see `tests/helpers/postgres.ts`) so the replay-protection
  atomicity tests exercise a real database, not a mock.

## Status

This is a complete, working reference implementation of the architecture
described in `docs/ARCHITECTURE.md`, with 199 passing tests including a
dedicated adversarial security suite. It is not a finished, audited
commercial product — read `SECURITY_AUDIT.md` for what has and hasn't
been verified, and known gaps (WebAuthn/passkey enrollment is scaffolded
but not implemented; no automated data-retention pruning job; no
key-rotation grace-period overlap) before relying on it for a real
deployment.

## License

Unlicensed reference implementation — see individual package.json files.
