import { describe, expect, it, vi } from "vitest";
import { createGateKeeperClient } from "./index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("createGateKeeperClient", () => {
  it("sends the secret key as a Bearer token and returns the server's result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, outcome: "SUCCESS", riskLevel: "LOW" }));
    const client = createGateKeeperClient({ secretKey: "gk_secret_test", fetchImpl });

    const result = await client.verify({ token: "tok", action: "signup" });

    expect(result).toEqual({ success: true, outcome: "SUCCESS", riskLevel: "LOW" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("/api/v1/verify");
    expect(init.headers.authorization).toBe("Bearer gk_secret_test");
  });

  it("propagates a failed verification as success:false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: false, outcome: "ALREADY_CONSUMED", riskLevel: "CRITICAL" }));
    const client = createGateKeeperClient({ secretKey: "gk_secret_test", fetchImpl });

    const result = await client.verify({ token: "tok", action: "signup" });
    expect(result.success).toBe(false);
    expect(result.outcome).toBe("ALREADY_CONSUMED");
  });

  it("denies by default when the service is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createGateKeeperClient({ secretKey: "gk_secret_test", fetchImpl, retries: 0 });

    const result = await client.verify({ token: "tok", action: "signup" });
    expect(result.success).toBe(false);
    expect(result.outcome).toBe("SERVICE_UNAVAILABLE");
    expect(result.degraded).toBe(true);
  });

  it("allows through when explicitly configured to fail open, and marks the result degraded", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createGateKeeperClient({ secretKey: "gk_secret_test", fetchImpl, retries: 0, onServiceUnavailable: "allow" });

    const result = await client.verify({ token: "tok", action: "signup" });
    expect(result.success).toBe(true);
    expect(result.degraded).toBe(true);
  });

  it("retries the configured number of times before giving up", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));
    const client = createGateKeeperClient({ secretKey: "gk_secret_test", fetchImpl, retries: 2 });

    await client.verify({ token: "tok", action: "signup" });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
