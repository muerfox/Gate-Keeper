export interface GateKeeperServerOptions {
  /** Secret server key — from the dashboard, never exposed to a browser.
   * Loaded from your own environment/secret manager, never hardcoded. */
  secretKey: string;
  apiUrl?: string;
  /**
   * Policy applied ONLY when the Gate Keeper API itself cannot be reached
   * (network failure / DNS / connection refused) — NOT applied when the
   * API responds with a verification failure, which always means
   * `success: false` regardless of this setting (docs/ARCHITECTURE.md
   * §Failure Modes). There is no default: an unconfigured policy fails
   * closed (`deny`) and logs a warning, per docs/THREAT_MODEL.md's stance
   * that "never trust the client" extends to never silently downgrading
   * security when a dependency is unavailable.
   */
  onServiceUnavailable?: "allow" | "deny";
  /** Number of retry attempts (with backoff) before applying
   * onServiceUnavailable. Default 2. */
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface ServerVerifyInput {
  token: string;
  action: string;
}

export interface ServerVerifyResult {
  success: boolean;
  outcome: string;
  riskLevel: string;
  /** True only when this result came from the onServiceUnavailable=allow
   * fallback rather than an actual server verification — integrators
   * should treat this distinctly (e.g. log it) since it is NOT a real
   * security decision. */
  degraded?: boolean;
}

const DEFAULT_API_URL = "https://api.gatekeeper.dev";

/**
 * Backend SDK: the ONLY supported way to actually trust a Gate Keeper
 * verification. A `success: true` returned to (or claimed by) the browser
 * is never sufficient on its own — your server must call `verify()` itself
 * with your secret key (docs/THREAT_MODEL.md §"Never trust the client").
 * This call also ATOMICALLY CONSUMES the token: a second call with the
 * same token — from this process or a concurrent one — will always fail
 * with `ALREADY_CONSUMED` (docs/ARCHITECTURE.md §Replay Protection).
 */
export function createGateKeeperClient(options: GateKeeperServerOptions) {
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL;
  const retries = options.retries ?? 2;
  const policy = options.onServiceUnavailable ?? "deny";
  const fetchImpl = options.fetchImpl ?? fetch;

  async function verify(input: ServerVerifyInput): Promise<ServerVerifyResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(`${apiUrl}/api/v1/verify`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${options.secretKey}` },
          body: JSON.stringify(input),
        });

        if (res.status === 401) {
          throw new Error("gatekeeper: invalid secret key");
        }

        const body = (await res.json()) as { success: boolean; outcome: string; riskLevel: string };
        return { success: body.success, outcome: body.outcome, riskLevel: body.riskLevel };
      } catch (err) {
        lastError = err;
        if (attempt < retries) await backoff(attempt);
      }
    }

    if (policy === "allow") {
      // eslint-disable-next-line no-console
      console.warn(
        "gatekeeper: verification service unavailable, allowing request per onServiceUnavailable='allow'. " +
          "This is a deliberate security tradeoff you configured — see docs/ARCHITECTURE.md §Failure Modes.",
        lastError,
      );
      return { success: true, outcome: "SERVICE_UNAVAILABLE_ALLOWED", riskLevel: "UNKNOWN" as never, degraded: true };
    }

    return { success: false, outcome: "SERVICE_UNAVAILABLE", riskLevel: "UNKNOWN" as never, degraded: true };
  }

  return { verify };
}

function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
}
