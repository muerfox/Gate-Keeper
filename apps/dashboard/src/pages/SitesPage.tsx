import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useSites } from "../SiteContext.js";

export function SitesPage() {
  const { sites, isLoading } = useSites();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [environment, setEnvironment] = useState<"DEVELOPMENT" | "PRODUCTION">("PRODUCTION");

  const createSite = useMutation({
    mutationFn: () =>
      api.createSite({
        name,
        environment,
        domains: domains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setShowForm(false);
      setName("");
      setDomains("");
    },
  });

  return (
    <div>
      <div className="page-header">
        <h1>Sites</h1>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "New site"}
        </button>
      </div>

      {showForm && (
        <form
          className="card"
          style={{ marginBottom: 20, maxWidth: 480 }}
          onSubmit={(e) => {
            e.preventDefault();
            createSite.mutate();
          }}
        >
          <div className="form-row">
            <label htmlFor="site-name">Name</label>
            <input id="site-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="site-domains">Allowed domains (comma-separated, optional)</label>
            <input id="site-domains" type="text" placeholder="example.com, app.example.com" value={domains} onChange={(e) => setDomains(e.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="site-env">Environment</label>
            <select id="site-env" value={environment} onChange={(e) => setEnvironment(e.target.value as "DEVELOPMENT" | "PRODUCTION")}>
              <option value="PRODUCTION">Production</option>
              <option value="DEVELOPMENT">Development</option>
            </select>
          </div>
          {createSite.isError && <p className="error-text">Failed to create site.</p>}
          <button className="btn" type="submit" disabled={createSite.isPending}>
            Create site
          </button>
        </form>
      )}

      {isLoading && <p className="muted">Loading…</p>}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Environment</th>
            <th>Domains</th>
            <th>API keys</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id}>
              <td>{site.name}</td>
              <td>{site.environment}</td>
              <td className="muted">{site.domains.map((d) => d.hostname).join(", ") || "any (unrestricted)"}</td>
              <td>{site._count.apiKeys}</td>
              <td>
                <Link to={`/sites/${site.id}`}>Manage →</Link>
              </td>
            </tr>
          ))}
          {sites.length === 0 && !isLoading && (
            <tr>
              <td colSpan={5} className="muted">
                No sites yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
