import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import { useSites, SiteSwitcher } from "../SiteContext.js";

const RISK_COLORS: Record<string, string> = { LOW: "#22c55e", MEDIUM: "#f59e0b", HIGH: "#ef4444", CRITICAL: "#b91c1c" };

export function RiskAnalyticsPage() {
  const { selectedSiteId } = useSites();
  const { data } = useQuery({
    queryKey: ["analytics", selectedSiteId, "risk"],
    queryFn: () => api.analytics(selectedSiteId!, 24 * 7),
    enabled: Boolean(selectedSiteId),
  });

  const chartData = data?.riskLevelDistribution.map((r) => ({ name: r.riskLevel, count: r.count })) ?? [];

  return (
    <div>
      <div className="page-header">
        <h1>Risk Analytics</h1>
        <SiteSwitcher />
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Risk level distribution over the last 7 days, produced by the server-side risk engine (never a client-submitted score).
      </p>

      <div className="card" style={{ height: 320 }}>
        {chartData.length === 0 ? (
          <p className="muted">No risk events in this window yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#22304f" />
              <XAxis dataKey="name" stroke="#8a97b3" />
              <YAxis stroke="#8a97b3" allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#0f1830", border: "1px solid #22304f" }} />
              <Bar dataKey="count">
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={RISK_COLORS[entry.name] ?? "#3b82f6"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
