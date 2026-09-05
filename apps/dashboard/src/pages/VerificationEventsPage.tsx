import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { useSites, SiteSwitcher } from "../SiteContext.js";

export function VerificationEventsPage() {
  const { selectedSiteId } = useSites();
  const { data, isLoading } = useQuery({
    queryKey: ["verification-attempts", selectedSiteId],
    queryFn: () => api.verificationAttempts({ siteId: selectedSiteId!, limit: 50 }),
    enabled: Boolean(selectedSiteId),
  });

  return (
    <div>
      <div className="page-header">
        <h1>Verification Events</h1>
        <SiteSwitcher />
      </div>

      {isLoading && <p className="muted">Loading…</p>}

      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Outcome</th>
            <th>Risk level</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {data?.attempts.map((a) => (
            <tr key={a.id}>
              <td>{a.action}</td>
              <td>{a.outcome}</td>
              <td>
                <span className={`badge badge-${a.riskLevel.toLowerCase()}`}>{a.riskLevel}</span>
              </td>
              <td className="muted">{new Date(a.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {data?.attempts.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No verification attempts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
