# Smoke-testing a Gate Keeper build

This is the fastest way to prove a Gate Keeper build actually works end
to end, without touching your main dev stack. It brings up a fully
separate, disposable set of containers (its own Postgres and Redis, on
different ports and volumes from `docker-compose.yml`) and a minimal
login page at **http://127.0.0.1:8000** guarded by the real widget.

Nothing here is mocked: the page in your browser talks to the real
Gate Keeper API, and the login page's own backend independently
re-verifies the resulting token before checking a password — exactly the
flow described in `docs/THREAT_MODEL.md`'s "never trust the client"
rule. This is not a substitute for `tests/security` (the adversarial
suite); it's a fast, visual "did I wire this up correctly" check.

## Run it

Requires only Docker and Docker Compose — no host Node install, no
`npm install`, no manual key generation. From the repo root:

```sh
docker compose -f docker-compose.test.yml up -d --build
```

(If you have Node/npm available, `npm run smoke:up` runs the exact same
command — it's just a shortcut, not a requirement.)

That one command does everything, entirely inside containers:
1. `postgres-test` / `redis-test` come up.
2. `keygen` — a one-shot container — generates a throwaway signing key
   and encryption key using the already-built `@gatekeeper/crypto`
   *inside the image* and writes them to a shared volume. It reuses
   whatever's already there from a previous run, so this is idempotent.
3. `api-test` waits for `keygen` to finish and Postgres/Redis to be
   healthy, sources the generated keys, and starts the real API.
4. `test-login` waits for the API to report healthy, applies the
   database schema, seeds one throwaway test site + API key pair, and
   starts serving the login page.

First run takes a few minutes (image builds); after that, seconds.

**Open the login page:**

**http://127.0.0.1:8000**

You'll see a login form pre-filled with the demo credentials
(`demo` / `gatekeeper-test`) and the real Gate Keeper widget.

## What "it's working" looks like

1. **Solve the challenge.** The "Log in" button stays disabled until the
   widget reports success — that's the client-side SDK talking to the
   real, running API to request and verify a challenge.
2. **Click "Log in".** The result box turns green with
   `"ok": true` and a message confirming the *server* independently
   re-verified the token against the API before checking the password —
   not just the browser's say-so.
3. **Click "Simulate bot (skip CAPTCHA)"** instead, without solving
   anything. This submits the same login request with no token at all —
   the way a scripted attacker calling your login endpoint directly
   would. The result box turns red with `"stage": "captcha"`: the server
   rejected it before even looking at the username or password. This is
   the part that actually proves something — a login page that "works"
   only when a human clicks through the widget isn't proof of anything;
   a login page that *also* rejects the no-token case is.
4. Optionally, try submitting a stale or already-used token (solve the
   widget once, click "Log in" twice) — the second attempt should fail
   with an outcome indicating the token was already consumed
   (`docs/ARCHITECTURE.md` §Replay Protection).

If step 2 doesn't turn green, or step 3 doesn't turn red, something in
the deployment is misconfigured — see Troubleshooting below before
assuming the platform itself is broken.

## Stopping / resetting

```sh
docker compose -f docker-compose.test.yml down       # stop, keep data
docker compose -f docker-compose.test.yml down -v    # stop and wipe everything (database + generated keys)
```
The test site's API keys are regenerated on every container start (see
the comment in `apps/test-login/scripts/seed-test.ts`), so there's
rarely a reason to preserve `-v` data between runs.

## What's actually running

| Service | Purpose | Host port |
|---|---|---|
| `postgres-test` | Isolated database for this stack only | 127.0.0.1:5433 |
| `redis-test` | Isolated cache/rate-limit store | 127.0.0.1:6380 |
| `keygen` | One-shot: generates the throwaway keys, then exits | — |
| `api-test` | The real Gate Keeper verification API | 127.0.0.1:8081 |
| `test-login` | The login page + its own tiny backend | 127.0.0.1:8000 |

All ports are bound to `127.0.0.1` only — nothing here is exposed
outside your machine. Everything runs from the same source you have
checked out (`build:` in `docker-compose.test.yml` builds from `.`), so
this reflects your current working tree, not a published image.

## Troubleshooting

- **Page says "Not seeded yet"** — the `test-login` container is still
  waiting on `api-test` to become healthy, or is still running its own
  schema-push/seed step. Check
  `docker compose -f docker-compose.test.yml logs -f test-login`.
- **`api-test` won't start / crash-loops immediately** — check
  `docker compose -f docker-compose.test.yml logs keygen` first; if
  `keygen` failed, `api-test` had nothing to source. Re-run
  `docker compose -f docker-compose.test.yml up -d --build` — `keygen`
  is safe to re-run.
- **Want a completely fresh signing/encryption key pair** — the
  `keygen` container reuses whatever's already on the
  `gatekeeper_test_keys` volume, so it won't rotate them on its own. Run
  `docker compose -f docker-compose.test.yml down -v` (wipes both that
  volume and the test database) and bring the stack back up.
- **Port already in use (5433/6380/8081/8000)** — something else on
  your machine is using it. Stop that process, or edit the `ports:`
  mappings in `docker-compose.test.yml`.
- **"Simulate bot" doesn't turn red / login succeeds without solving
  anything** — that would mean server-side re-verification isn't
  actually being enforced. Check `apps/test-login/server.ts`'s `/login`
  handler is checking `body.token` before calling `backendClient.verify`,
  and that `api-test`'s logs (`docker compose -f docker-compose.test.yml logs api-test`)
  show a rejection for the token-less request.
- **Want to see the raw API traffic** — `docker compose -f docker-compose.test.yml logs -f api-test`.

## Cleaning up permanently

```sh
docker compose -f docker-compose.test.yml down -v
docker rmi $(docker compose -f docker-compose.test.yml images -q) 2>/dev/null
```
