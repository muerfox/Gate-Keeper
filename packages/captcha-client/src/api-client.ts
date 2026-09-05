import type { InteractionEvent, PublicChallenge, VerifyResult } from "@gatekeeper/shared";
import { GateKeeperError } from "./types.js";

const DEFAULT_API_URL = "https://api.gatekeeper.dev";

export class ApiClient {
  constructor(private readonly baseUrl: string = DEFAULT_API_URL) {}

  async requestChallenge(input: { siteKey: string; action: string; accessible?: boolean }): Promise<PublicChallenge> {
    const res = await this.post("/api/v1/challenge", input);
    if (!res.ok) {
      throw new GateKeeperError(errorCodeFor(res.status), `challenge request failed (${res.status})`);
    }
    return res.json() as Promise<PublicChallenge>;
  }

  async submitAnswer(input: {
    siteKey: string;
    action: string;
    challengeId: string;
    signedEnvelope: string;
    answer: unknown;
    events: InteractionEvent[];
  }): Promise<VerifyResult> {
    const res = await this.post("/api/v1/verify", input);
    if (!res.ok) {
      throw new GateKeeperError(errorCodeFor(res.status), `verify request failed (${res.status})`);
    }
    return res.json() as Promise<VerifyResult>;
  }

  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // Never send/receive cookies cross-origin here — the widget's trust
      // model is the signed envelope/token, not a session cookie
      // (docs/THREAT_MODEL.md: the widget is not a security boundary).
      credentials: "omit",
    });
  }
}

function errorCodeFor(status: number): string {
  if (status === 401) return "invalid_site_key";
  if (status === 403) return "domain_not_allowed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "service_unavailable";
  return "request_failed";
}
