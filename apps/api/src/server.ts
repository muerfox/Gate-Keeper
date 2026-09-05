import { loadEnv } from "./env.js";
import { buildContext } from "./context.js";
import { buildApp } from "./app.js";
import pino from "pino";

async function main() {
  const env = loadEnv();
  const logger = pino({ level: env.NODE_ENV === "production" ? "info" : "debug" });
  const ctx = await buildContext(env, logger);
  const app = await buildApp(ctx);

  app.addHook("onClose", async () => {
    await ctx.db.$disconnect();
    ctx.redis.disconnect();
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Gate Keeper API failed to start:", err);
  process.exit(1);
});
