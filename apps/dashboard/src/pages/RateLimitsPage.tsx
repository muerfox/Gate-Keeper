import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { useSites, SiteSwitcher } from "../SiteContext.js";

export function RateLimitsPage() {
  const { selectedSiteId } = useSites();
  const { data, isLoading } = useQuery({
    queryKey: ["events", selectedSiteId, "RATE_LIMIT_EXCEEDED"],
    queryFn: () => api.events({ siteId: selectedSiteId!, type: "RATE_LIMIT_EXCEEDED", limit: 50 }),
    enabled: Boolean(selectedSiteId),
  });

  return (
    <div>
      <div className="page-header">
        <h1>Rate Limits</h1>
        <SiteSwitcher />
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Recent rate-limit events, across IP/site/action/session/API-key dimensions (see docs/ARCHITECTURE.md).
      </p>

      {isLoading && <p className="muted">Loading…</p>}

      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th>Endpoint</th>
            <th>IP</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {data?.events.map((e) => {
            const detail = e.detail as { rule?: string; endpoint?: string };
            return (
              <tr key={e.id}>
                <td>{detail.rule ?? "—"}</td>
                <td>{detail.endpoint ?? "—"}</td>
                <td className="muted">{e.requestIp ?? "unrecorded"}</td>
                <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
              </tr>
            );
          })}
          {data?.events.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No rate-limit events recorded — traffic is within configured limits.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
