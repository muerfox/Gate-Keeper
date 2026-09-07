import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";

export function AuditLogsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["audit-logs"], queryFn: () => api.auditLogs(100) });

  return (
    <div>
      <div className="page-header">
        <h1>Audit Logs</h1>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Every privileged action taken by an administrator — site/key creation, key revocation, configuration changes.
      </p>

      {isLoading && <p className="muted">Loading…</p>}

      <table>
        <thead>
          <tr>
            <th>Admin</th>
            <th>Action</th>
            <th>Target</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {data?.logs.map((log) => (
            <tr key={log.id}>
              <td>{log.admin?.email ?? "system"}</td>
              <td>{log.action}</td>
              <td className="muted">
                {log.targetType ? `${log.targetType}:${log.targetId}` : "—"}
              </td>
              <td className="muted">{new Date(log.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {data?.logs.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No audit log entries yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
