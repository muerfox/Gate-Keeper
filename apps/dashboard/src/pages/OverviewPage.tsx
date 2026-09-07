import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { useSites, SiteSwitcher } from "../SiteContext.js";

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function OverviewPage() {
  const { selectedSiteId } = useSites();
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", selectedSiteId],
    queryFn: () => api.analytics(selectedSiteId!, 24),
    enabled: Boolean(selectedSiteId),
  });

  return (
    <div>
      <div className="page-header">
        <h1>Overview</h1>
        <SiteSwitcher />
      </div>

      {!selectedSiteId && <p className="muted">Select or create a site to see its overview.</p>}
      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">Failed to load analytics.</p>}

      {data && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 20 }}>
            <StatTile label="Total requests (24h)" value={data.totalRequests} />
            <StatTile label="Successful verifications" value={data.successfulVerifications} />
            <StatTile label="Failed verifications" value={data.failedVerifications} />
            <StatTile label="Rate-limit events" value={data.rateLimitEvents} />
          </div>
          <div className="grid grid-2">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Outcome breakdown</h3>
              <table>
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outcomeBreakdown.map((row) => (
                    <tr key={row.outcome}>
                      <td>{row.outcome}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                  {data.outcomeBreakdown.length === 0 && (
                    <tr>
                      <td colSpan={2} className="muted">
                        No traffic in this window yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Risk level distribution</h3>
              <table>
                <thead>
                  <tr>
                    <th>Risk level</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.riskLevelDistribution.map((row) => (
                    <tr key={row.riskLevel}>
                      <td>
                        <span className={`badge badge-${row.riskLevel.toLowerCase()}`}>{row.riskLevel}</span>
                      </td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                  {data.riskLevelDistribution.length === 0 && (
                    <tr>
                      <td colSpan={2} className="muted">
                        No traffic in this window yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
