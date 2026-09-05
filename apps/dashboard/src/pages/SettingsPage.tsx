import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { useSites, SiteSwitcher } from "../SiteContext.js";

interface SiteConfigShape {
  lowRiskAutoAllow: boolean;
  criticalAction: "block" | "throttle";
  redisFailurePolicy: "fail_open" | "fail_closed";
  dbFailurePolicy: "fail_open" | "fail_closed";
  ipProcessingEnabled: boolean;
  analyticsEnabled: boolean;
  computationalChallengesEnabled: boolean;
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div>
        <div>{label}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {description}
        </div>
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: "auto" }} />
    </div>
  );
}

export function SettingsPage() {
  const { selectedSiteId } = useSites();
  const queryClient = useQueryClient();
  const { data: site } = useQuery({ queryKey: ["site", selectedSiteId], queryFn: () => api.getSite(selectedSiteId!), enabled: Boolean(selectedSiteId) });
  const [config, setConfig] = useState<SiteConfigShape | null>(null);

  useEffect(() => {
    if (site?.config) setConfig(site.config as unknown as SiteConfigShape);
  }, [site]);

  const save = useMutation({
    mutationFn: (patch: Partial<SiteConfigShape>) => api.updateSiteConfig(selectedSiteId!, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site", selectedSiteId] }),
  });

  function update<K extends keyof SiteConfigShape>(key: K, value: SiteConfigShape[K]) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
    save.mutate({ [key]: value });
  }

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <SiteSwitcher />
      </div>

      {!config && <p className="muted">Select a site to view its configuration.</p>}

      {config && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>Risk decisions</h3>
          <Toggle
            label="Auto-allow low risk"
            description="LOW-risk sessions are allowed without an interactive challenge (invisible mode)."
            checked={config.lowRiskAutoAllow}
            onChange={(v) => update("lowRiskAutoAllow", v)}
          />
          <div className="toggle-row">
            <div>
              <div>Critical risk action</div>
              <div className="muted" style={{ fontSize: 12 }}>
                What happens to CRITICAL-risk requests.
              </div>
            </div>
            <select style={{ width: 140 }} value={config.criticalAction} onChange={(e) => update("criticalAction", e.target.value as "block" | "throttle")}>
              <option value="block">Block</option>
              <option value="throttle">Throttle</option>
            </select>
          </div>

          <h3>Computational challenges</h3>
          <Toggle
            label="Allow computational challenges"
            description="Permit proof-of-work / cryptographic-proof challenge types (docs/THREAT_MODEL.md §4.5)."
            checked={config.computationalChallengesEnabled}
            onChange={(v) => update("computationalChallengesEnabled", v)}
          />

          <h3>Privacy</h3>
          <Toggle
            label="IP processing"
            description="Store request IP addresses for risk scoring and audit. Off by default (docs/PRIVACY.md)."
            checked={config.ipProcessingEnabled}
            onChange={(v) => update("ipProcessingEnabled", v)}
          />
          <Toggle
            label="Analytics"
            description="Aggregate verification analytics for the dashboard."
            checked={config.analyticsEnabled}
            onChange={(v) => update("analyticsEnabled", v)}
          />

          <h3>Failure-mode policy</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
            What happens if Redis or the database becomes unavailable (docs/ARCHITECTURE.md §Failure Modes). Fail-closed is safer by default; fail-open trades security for availability.
          </p>
          <div className="toggle-row">
            <div>Redis unavailable</div>
            <select style={{ width: 140 }} value={config.redisFailurePolicy} onChange={(e) => update("redisFailurePolicy", e.target.value as "fail_open" | "fail_closed")}>
              <option value="fail_closed">Fail closed</option>
              <option value="fail_open">Fail open</option>
            </select>
          </div>
          <div className="toggle-row">
            <div>Database unavailable</div>
            <select style={{ width: 140 }} value={config.dbFailurePolicy} onChange={(e) => update("dbFailurePolicy", e.target.value as "fail_open" | "fail_closed")}>
              <option value="fail_closed">Fail closed</option>
              <option value="fail_open">Fail open</option>
            </select>
          </div>

          {save.isPending && <p className="muted">Saving…</p>}
        </div>
      )}
    </div>
  );
}
