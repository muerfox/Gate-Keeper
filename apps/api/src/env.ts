import { z } from "zod";

/** Fails fast on missing/invalid configuration rather than starting with an
 * insecure implicit default (docs/THREAT_MODEL.md). No default value is
 * provided here for anything security-relevant. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GATEKEEPER_SIGNING_KEY: z.string().min(1),
  GATEKEEPER_ENCRYPTION_KEY: z.string().min(1),
  GATEKEEPER_REDIS_FAILURE_POLICY: z.enum(["fail_open", "fail_closed"]).default("fail_closed"),
  GATEKEEPER_DB_FAILURE_POLICY: z.enum(["fail_open", "fail_closed"]).default("fail_closed"),
  GATEKEEPER_CORS_ORIGINS: z.string().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid Gate Keeper API configuration: ${issues}`);
  }
  return result.data;
}
