import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

/**
 * Baseline security headers for every response (docs spec: "Support modern
 * security headers"). CSP here is the API's own (JSON responses, so a
 * maximally restrictive policy is safe) — the dashboard app ships its own,
 * separate CSP tuned for a real UI (infrastructure/docker/dashboard.nginx.conf).
 * Site-specific widget CSP guidance for CUSTOMER pages lives in
 * docs/SECURITY.md, since Gate Keeper cannot set headers on a page it
 * doesn't serve.
 */
export async function registerSecurityHeaders(app: FastifyInstance, corsOrigins: string[]): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" }, // the widget is embedded on customer sites
  });

  await app.register(cors, {
    // The verification endpoints are deliberately called cross-origin from
    // customer sites — that's the whole point of a hosted CAPTCHA. Origin
    // trust for state-changing outcomes still comes from the signed
    // envelope + registered-domain check (domains.ts), NOT from CORS, which
    // is a browser-enforced, attacker-bypassable control when the request
    // is made outside a browser (docs/THREAT_MODEL.md §4.10).
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ["GET", "POST", "DELETE"],
  });
}
