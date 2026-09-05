/**
 * Provisions a demo administrator, a demo site, and a public/secret key
 * pair directly via Prisma — bypassing the admin API's own auth, exactly
 * the way a one-time database seed script legitimately would in any real
 * deployment. Requires DATABASE_URL to point at the same Postgres the
 * running apps/api instance uses (see docker-compose.yml).
 *
 * Usage: DATABASE_URL=... npx tsx apps/demo/scripts/seed-demo.ts
 */
import { PrismaClient } from "@gatekeeper/shared/prisma";
import { hashPassword, randomId, hashSecret } from "@gatekeeper/crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateKey(type: "PUBLIC_SITE_KEY" | "SECRET_SERVER_KEY") {
  const prefix = type === "PUBLIC_SITE_KEY" ? "gk_pub_" : "gk_secret_";
  const value = `${prefix}${randomId(24)}`;
  return { value, keyPrefix: value.slice(0, 16), keyHash: hashSecret(value) };
}

async function main() {
  const db = new PrismaClient();

  const adminEmail = process.env.GK_DEMO_ADMIN_EMAIL ?? "demo@gatekeeper.local";
  const adminPassword = process.env.GK_DEMO_ADMIN_PASSWORD ?? "gatekeeper-demo-password";

  await db.administrator.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, passwordHash: await hashPassword(adminPassword), role: "OWNER" },
  });

  let site = await db.site.findFirst({ where: { name: "Gate Keeper Demo" } });
  if (!site) {
    site = await db.site.create({ data: { name: "Gate Keeper Demo", environment: "DEVELOPMENT", config: { create: {} } } });
  }

  const publicKey = generateKey("PUBLIC_SITE_KEY");
  const secretKey = generateKey("SECRET_SERVER_KEY");

  await db.apiKey.create({
    data: { siteId: site.id, type: "PUBLIC_SITE_KEY", environment: "DEVELOPMENT", keyPrefix: publicKey.keyPrefix, keyHash: publicKey.keyHash, publicValue: publicKey.value },
  });
  await db.apiKey.create({
    data: { siteId: site.id, type: "SECRET_SERVER_KEY", environment: "DEVELOPMENT", keyPrefix: secretKey.keyPrefix, keyHash: secretKey.keyHash },
  });

  const envFile = path.resolve(__dirname, "../.env.demo");
  writeFileSync(
    envFile,
    [
      `GK_DEMO_SITE_KEY=${publicKey.value}`,
      `GK_DEMO_SECRET_KEY=${secretKey.value}`,
      `GK_DEMO_ADMIN_EMAIL=${adminEmail}`,
      `GK_DEMO_ADMIN_PASSWORD=${adminPassword}`,
      "",
    ].join("\n"),
  );

  console.log(`Seeded demo site "${site.name}" (${site.id})`);
  console.log(`Wrote keys to ${envFile}`);
  console.log(`Dashboard login: ${adminEmail} / ${adminPassword}`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
