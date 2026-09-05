import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { useSites, SiteSwitcher } from "../SiteContext.js";

export function SecurityEventsPage() {
  const { selectedSiteId } = useSites();
  const { data, isLoading } = useQuery({
    queryKey: ["events", selectedSiteId, "all"],
    queryFn: () => api.events({ siteId: selectedSiteId!, limit: 100 }),
    enabled: Boolean(selectedSiteId),
  });

  return (
    <div>
      <div className="page-header">
        <h1>Security Events</h1>
        <SiteSwitcher />
      </div>

      {isLoading && <p className="muted">Loading…</p>}

      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Severity</th>
            <th>IP</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {data?.events.map((e) => (
            <tr key={e.id}>
              <td>{e.type}</td>
              <td>
                <span className={`badge badge-${e.severity.toLowerCase()}`}>{e.severity}</span>
              </td>
              <td className="muted">{e.requestIp ?? "unrecorded"}</td>
              <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {data?.events.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No security events recorded for this site.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
