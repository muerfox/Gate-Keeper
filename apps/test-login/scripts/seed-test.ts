/**
 * Provisions a single, disposable site + API key pair for the test-login
 * smoke test — deliberately nothing else (no administrator, no dashboard
 * access). Run against the same Postgres the sibling api-test service
 * uses.
 *
 * Runs fresh every time: deletes any previous "Gate Keeper Test Login"
 * site (cascades to its keys) and recreates it, then writes the new keys
 * to .env.test-runtime. That's deliberate — this container's own
 * filesystem doesn't persist across a rebuild even when the Postgres
 * volume does, and a secret key's plaintext can't be recovered once
 * created (only its hash is stored), so "reuse the old one" isn't an
 * option. A throwaway test site doesn't need to survive restarts.
 *
 * Usage: DATABASE_URL=... npx tsx apps/test-login/scripts/seed-test.ts
 */
import { PrismaClient } from "@gatekeeper/shared/prisma";
import { randomId, hashSecret } from "@gatekeeper/crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_NAME = "Gate Keeper Test Login";

function generateKey(type: "PUBLIC_SITE_KEY" | "SECRET_SERVER_KEY") {
  const prefix = type === "PUBLIC_SITE_KEY" ? "gk_pub_" : "gk_secret_";
  const value = `${prefix}${randomId(24)}`;
  return { value, keyPrefix: value.slice(0, 16), keyHash: hashSecret(value) };
}

async function main() {
  const db = new PrismaClient();

  await db.site.deleteMany({ where: { name: SITE_NAME } });
  const site = await db.site.create({ data: { name: SITE_NAME, environment: "DEVELOPMENT", config: { create: {} } } });

  const publicKey = generateKey("PUBLIC_SITE_KEY");
  const secretKey = generateKey("SECRET_SERVER_KEY");

  await db.apiKey.create({
    data: { siteId: site.id, type: "PUBLIC_SITE_KEY", environment: "DEVELOPMENT", keyPrefix: publicKey.keyPrefix, keyHash: publicKey.keyHash, publicValue: publicKey.value },
  });
  await db.apiKey.create({
    data: { siteId: site.id, type: "SECRET_SERVER_KEY", environment: "DEVELOPMENT", keyPrefix: secretKey.keyPrefix, keyHash: secretKey.keyHash },
  });

  const envFile = path.resolve(__dirname, "../.env.test-runtime");
  writeFileSync(envFile, [`GK_TEST_SITE_KEY=${publicKey.value}`, `GK_TEST_SECRET_KEY=${secretKey.value}`, ""].join("\n"));
  console.log(`Seeded site "${site.name}" (${site.id}) and wrote keys to ${envFile}`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
