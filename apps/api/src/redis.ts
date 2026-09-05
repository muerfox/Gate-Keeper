import { createRedisClient, type Redis } from "@gatekeeper/rate-limit";

export function createAppRedisClient(url: string): Redis {
  const client = createRedisClient(url);
  client.on("error", () => {
    // Swallow here — callers observe failures via rejected command
    // promises (FailoverReplayStore / rate limiter callers), and we don't
    // want an unhandled 'error' event to crash the process. Connection
    // health is still logged by the caller's degraded-mode handling.
  });
  return client;
}
