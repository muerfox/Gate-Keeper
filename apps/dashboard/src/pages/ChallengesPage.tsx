import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { useSites, SiteSwitcher } from "../SiteContext.js";

export function ChallengesPage() {
  const { selectedSiteId } = useSites();
  const { data, isLoading } = useQuery({
    queryKey: ["challenges", selectedSiteId],
    queryFn: () => api.challenges({ siteId: selectedSiteId!, limit: 50 }),
    enabled: Boolean(selectedSiteId),
  });

  return (
    <div>
      <div className="page-header">
        <h1>Challenges</h1>
        <SiteSwitcher />
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Recently issued challenges. Difficulty distribution here reflects the risk engine's adaptive escalation.
      </p>

      {isLoading && <p className="muted">Loading…</p>}

      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Action</th>
            <th>Difficulty</th>
            <th>Issued</th>
            <th>Expires</th>
          </tr>
        </thead>
        <tbody>
          {data?.challenges.map((c) => (
            <tr key={c.id}>
              <td>{c.type}</td>
              <td>{c.action}</td>
              <td>{c.difficulty}</td>
              <td className="muted">{new Date(c.issuedAt).toLocaleString()}</td>
              <td className="muted">{new Date(c.expiresAt).toLocaleString()}</td>
            </tr>
          ))}
          {data?.challenges.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No challenges issued yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
