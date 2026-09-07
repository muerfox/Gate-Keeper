import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Loads apps/demo/.env.demo (written by scripts/seed-demo.ts) into
 * process.env, without pulling in a dotenv dependency for one file. */
function loadDemoEnv(): void {
  const envFile = path.resolve(__dirname, ".env.demo");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1]!] ??= match[2];
  }
}

loadDemoEnv();

export const demoEnv = {
  port: Number(process.env.PORT ?? 3100),
  apiUrl: process.env.GATEKEEPER_API_URL ?? "http://localhost:8080",
  dashboardUrl: process.env.GATEKEEPER_DASHBOARD_URL ?? "http://localhost:5173",
  siteKey: process.env.GK_DEMO_SITE_KEY,
  secretKey: process.env.GK_DEMO_SECRET_KEY,
};
