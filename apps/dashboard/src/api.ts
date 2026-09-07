const API_URL = import.meta.env.VITE_GATEKEEPER_API_URL ?? "http://localhost:8080";

/**
 * Session token storage: sessionStorage (cleared when the tab closes, not
 * shared across tabs) rather than localStorage, to bound the token's
 * lifetime a little further. This reference dashboard uses a bearer token
 * over fetch rather than an httpOnly cookie for simplicity; a production
 * deployment fronting real customer data should prefer httpOnly
 * cookie-based sessions with CSRF protection — see docs/SECURITY.md.
 */
const SESSION_KEY = "gk_dashboard_session";

export function getSessionToken(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string | null): void {
  if (token) sessionStorage.setItem(SESSION_KEY, token);
  else sessionStorage.removeItem(SESSION_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSessionToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401) {
    setSessionToken(null);
    throw new ApiError(401, "Session expired — please log in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string, totp?: string) =>
    apiFetch<{ sessionToken: string; expiresAt: number; role: string }>("/api/v1/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
    }),
  logout: () => apiFetch<void>("/api/v1/admin/logout", { method: "POST" }),

  listSites: () => apiFetch<{ sites: SiteSummary[] }>("/api/v1/sites"),
  getSite: (siteId: string) => apiFetch<SiteDetail>(`/api/v1/site?siteId=${encodeURIComponent(siteId)}`),
  createSite: (input: { name: string; domains: string[]; environment: "DEVELOPMENT" | "PRODUCTION" }) =>
    apiFetch<SiteDetail>("/api/v1/sites", { method: "POST", body: JSON.stringify(input) }),
  updateSiteConfig: (siteId: string, patch: Record<string, unknown>) =>
    apiFetch<unknown>(`/api/v1/site/${siteId}/config`, { method: "PATCH", body: JSON.stringify(patch) }),

  createKey: (siteId: string, type: "PUBLIC_SITE_KEY" | "SECRET_SERVER_KEY", environment: "DEVELOPMENT" | "PRODUCTION") =>
    apiFetch<{ id: string; type: string; environment: string; value: string }>("/api/v1/keys", {
      method: "POST",
      body: JSON.stringify({ siteId, type, environment }),
    }),
  revokeKey: (id: string) => apiFetch<void>(`/api/v1/keys/${id}`, { method: "DELETE" }),

  analytics: (siteId: string, windowHours = 24) => apiFetch<Analytics>(`/api/v1/analytics?siteId=${siteId}&windowHours=${windowHours}`),
  events: (params: { siteId?: string; type?: string; limit?: number } = {}) =>
    apiFetch<{ events: SecurityEvent[] }>(`/api/v1/events?${new URLSearchParams(params as Record<string, string>).toString()}`),
  verificationAttempts: (params: { siteId?: string; limit?: number } = {}) =>
    apiFetch<{ attempts: VerificationAttempt[] }>(`/api/v1/verification-attempts?${new URLSearchParams(params as Record<string, string>).toString()}`),
  challenges: (params: { siteId?: string; limit?: number } = {}) =>
    apiFetch<{ challenges: ChallengeRow[] }>(`/api/v1/challenges?${new URLSearchParams(params as Record<string, string>).toString()}`),
  auditLogs: (limit = 50) => apiFetch<{ logs: AuditLogRow[] }>(`/api/v1/audit-logs?limit=${limit}`),
};

export interface SiteSummary {
  id: string;
  name: string;
  environment: string;
  createdAt: string;
  domains: { hostname: string }[];
  _count: { apiKeys: number };
}

export interface SiteDetail extends SiteSummary {
  config: Record<string, unknown> | null;
  apiKeys: { id: string; type: string; environment: string; keyPrefix: string; publicValue: string | null; createdAt: string; revokedAt: string | null }[];
}

export interface Analytics {
  windowHours: number;
  totalRequests: number;
  successfulVerifications: number;
  failedVerifications: number;
  outcomeBreakdown: { outcome: string; count: number }[];
  riskLevelDistribution: { riskLevel: string; count: number }[];
  rateLimitEvents: number;
  averageVerificationLatencyMs: number | null;
}

export interface SecurityEvent {
  id: string;
  siteId: string | null;
  type: string;
  severity: string;
  detail: unknown;
  requestIp: string | null;
  createdAt: string;
}

export interface VerificationAttempt {
  id: string;
  siteId: string;
  action: string;
  outcome: string;
  riskLevel: string;
  createdAt: string;
}

export interface ChallengeRow {
  id: string;
  siteId: string;
  action: string;
  type: string;
  difficulty: number;
  state: string;
  issuedAt: string;
  expiresAt: string;
}

export interface AuditLogRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  admin: { email: string } | null;
}
