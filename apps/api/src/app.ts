import Fastify, { type FastifyInstance } from "fastify";
import { MAX_REQUEST_BODY_BYTES } from "@gatekeeper/shared";
import type { AppContext } from "./context.js";
import { registerSecurityHeaders } from "./plugins/security-headers.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerChallengeRoute } from "./routes/challenge.js";
import { registerVerifyRoute } from "./routes/verify.js";
import { registerReportRoute } from "./routes/report.js";
import { registerSiteRoutes } from "./routes/sites.js";
import { registerKeyRoutes } from "./routes/keys.js";
import { registerEventsRoute } from "./routes/events.js";
import { registerAnalyticsRoute } from "./routes/analytics.js";
import { registerAdminAuthRoutes } from "./routes/admin.js";
import { registerVerificationAttemptsRoute } from "./routes/verification-attempts.js";
import { registerChallengesRoute } from "./routes/challenges.js";
import { registerAuditLogsRoute } from "./routes/audit-logs.js";

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: ctx.env.NODE_ENV === "test" ? false : true,
    bodyLimit: MAX_REQUEST_BODY_BYTES,
    trustProxy: true,
  });

  const corsOrigins = ctx.env.GATEKEEPER_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  await registerSecurityHeaders(app, corsOrigins);
  registerErrorHandler(app);

  app.get("/healthz", async () => ({ status: "ok" }));

  registerChallengeRoute(app, ctx);
  registerVerifyRoute(app, ctx);
  registerReportRoute(app, ctx);
  registerSiteRoutes(app, ctx);
  registerKeyRoutes(app, ctx);
  registerEventsRoute(app, ctx);
  registerAnalyticsRoute(app, ctx);
  registerAdminAuthRoutes(app, ctx);
  registerVerificationAttemptsRoute(app, ctx);
  registerChallengesRoute(app, ctx);
  registerAuditLogsRoute(app, ctx);

  return app;
}
