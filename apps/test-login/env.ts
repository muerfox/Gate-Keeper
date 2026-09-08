import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Loads apps/test-login/.env.test-runtime (written by scripts/seed-test.ts)
 * into process.env, without pulling in a dotenv dependency for one file. */
function loadRuntimeEnv(): void {
  const envFile = path.resolve(__dirname, ".env.test-runtime");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1]!] ??= match[2];
  }
}

loadRuntimeEnv();

export const testEnv = {
  port: Number(process.env.PORT ?? 8000),
  apiUrl: process.env.GATEKEEPER_API_URL ?? "http://localhost:8081",
  siteKey: process.env.GK_TEST_SITE_KEY,
  secretKey: process.env.GK_TEST_SECRET_KEY,
};
