import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type SiteSummary } from "./api.js";

interface SiteContextState {
  sites: SiteSummary[];
  selectedSiteId: string | null;
  setSelectedSiteId: (id: string) => void;
  isLoading: boolean;
}

const SiteContext = createContext<SiteContextState | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({ queryKey: ["sites"], queryFn: () => api.listSites() });
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(() => sessionStorage.getItem("gk_selected_site"));

  useEffect(() => {
    if (!selectedSiteId && data?.sites.length) {
      setSelectedSiteId(data.sites[0]!.id);
    }
  }, [data, selectedSiteId]);

  function select(id: string) {
    sessionStorage.setItem("gk_selected_site", id);
    setSelectedSiteId(id);
  }

  return (
    <SiteContext.Provider value={{ sites: data?.sites ?? [], selectedSiteId, setSelectedSiteId: select, isLoading }}>{children}</SiteContext.Provider>
  );
}

export function useSites(): SiteContextState {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSites must be used within SiteProvider");
  return ctx;
}

export function SiteSwitcher() {
  const { sites, selectedSiteId, setSelectedSiteId, isLoading } = useSites();

  if (isLoading) return <p className="muted">Loading sites…</p>;
  if (sites.length === 0) return <p className="muted">No sites yet — create one on the Sites page.</p>;

  return (
    <select value={selectedSiteId ?? ""} onChange={(e) => setSelectedSiteId(e.target.value)} style={{ width: 240 }}>
      {sites.map((site) => (
        <option key={site.id} value={site.id}>
          {site.name} ({site.environment})
        </option>
      ))}
    </select>
  );
}
