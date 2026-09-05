import { hashPassword } from "@gatekeeper/crypto";
import type { PrismaClient } from "../../apps/api/src/db.js";
import { generateKey } from "../../apps/api/src/keys/site-keys.js";

export async function createTestSite(db: PrismaClient, opts: { domains?: string[] } = {}) {
  const site = await db.site.create({
    data: {
      name: "Test Site",
      environment: "PRODUCTION",
      domains: { create: (opts.domains ?? []).map((hostname) => ({ hostname })) },
      config: { create: {} },
    },
  });

  const publicKey = generateKey("PUBLIC_SITE_KEY", "PRODUCTION");
  await db.apiKey.create({
    data: { siteId: site.id, type: "PUBLIC_SITE_KEY", environment: "PRODUCTION", keyPrefix: publicKey.keyPrefix, keyHash: publicKey.keyHash, publicValue: publicKey.value },
  });

  const secretKey = generateKey("SECRET_SERVER_KEY", "PRODUCTION");
  await db.apiKey.create({
    data: { siteId: site.id, type: "SECRET_SERVER_KEY", environment: "PRODUCTION", keyPrefix: secretKey.keyPrefix, keyHash: secretKey.keyHash },
  });

  return { site, siteKey: publicKey.value, secretKey: secretKey.value };
}

export async function createTestAdmin(db: PrismaClient, opts: { email?: string; password?: string; role?: "OWNER" | "ADMIN" | "VIEWER" } = {}) {
  const email = opts.email ?? "admin@example.com";
  const password = opts.password ?? "correct horse battery staple";
  const admin = await db.administrator.create({
    data: { email, passwordHash: await hashPassword(password), role: opts.role ?? "OWNER" },
  });
  return { admin, email, password };
}
