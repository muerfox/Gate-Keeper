#!/bin/sh
# Applies the DB schema and (re-)seeds a throwaway test site every time this
# container starts, then runs the server. Safe to run repeatedly — see the
# comment at the top of scripts/seed-test.ts for why it always resets.
set -e

echo "[test-login] applying database schema..."
npx prisma db push --schema packages/shared/prisma/schema.prisma --skip-generate --accept-data-loss

echo "[test-login] seeding test site..."
npx tsx apps/test-login/scripts/seed-test.ts

echo "[test-login] starting server..."
exec npx tsx apps/test-login/server.ts
