import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";

export function SiteDetailPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const queryClient = useQueryClient();
  const { data: site, isLoading } = useQuery({ queryKey: ["site", siteId], queryFn: () => api.getSite(siteId!), enabled: Boolean(siteId) });
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const createKey = useMutation({
    mutationFn: (input: { type: "PUBLIC_SITE_KEY" | "SECRET_SERVER_KEY"; environment: "DEVELOPMENT" | "PRODUCTION" }) =>
      api.createKey(siteId!, input.type, input.environment),
    onSuccess: (result) => {
      setRevealedKey(result.value);
      queryClient.invalidateQueries({ queryKey: ["site", siteId] });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => api.revokeKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site", siteId] }),
  });

  if (isLoading) return <p className="muted">Loading…</p>;
  if (!site) return <p className="error-text">Site not found.</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{site.name}</h1>
        <Link to="/sites">← All sites</Link>
      </div>

      {revealedKey && (
        <div className="card" style={{ marginBottom: 20, borderColor: "var(--warning)" }}>
          <strong>Copy this key now — it will not be shown again.</strong>
          <div className="key-value-reveal" style={{ marginTop: 8 }}>
            {revealedKey}
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => setRevealedKey(null)}>
            I've saved it
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>API Keys</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => createKey.mutate({ type: "PUBLIC_SITE_KEY", environment: "PRODUCTION" })}>
              + Public site key
            </button>
            <button className="btn btn-secondary" onClick={() => createKey.mutate({ type: "SECRET_SERVER_KEY", environment: "PRODUCTION" })}>
              + Secret server key
            </button>
          </div>
        </div>

        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Environment</th>
              <th>Value / prefix</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {site.apiKeys.map((key) => (
              <tr key={key.id} style={{ opacity: key.revokedAt ? 0.4 : 1 }}>
                <td>{key.type === "PUBLIC_SITE_KEY" ? "Public site key" : "Secret server key"}</td>
                <td>{key.environment}</td>
                <td className="muted" style={{ fontFamily: "monospace" }}>
                  {key.publicValue ?? `${key.keyPrefix}…`}
                </td>
                <td className="muted">{new Date(key.createdAt).toLocaleDateString()}</td>
                <td>
                  {!key.revokedAt && (
                    <button className="btn-danger" style={{ padding: "4px 10px", borderRadius: 6 }} onClick={() => revokeKey.mutate(key.id)}>
                      Revoke
                    </button>
                  )}
                  {key.revokedAt && <span className="muted">Revoked</span>}
                </td>
              </tr>
            ))}
            {site.apiKeys.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Domains</h3>
        {site.domains.length === 0 ? (
          <p className="muted">No domain restriction configured — the public key can be used from any origin. Add domains for production use.</p>
        ) : (
          <ul>
            {site.domains.map((d) => (
              <li key={d.hostname}>{d.hostname}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
