import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/sites", label: "Sites" },
  { to: "/challenges", label: "Challenges" },
  { to: "/verification-events", label: "Verification Events" },
  { to: "/risk-analytics", label: "Risk Analytics" },
  { to: "/rate-limits", label: "Rate Limits" },
  { to: "/security-events", label: "Security Events" },
  { to: "/audit-logs", label: "Audit Logs" },
  { to: "/settings", label: "Settings" },
  { to: "/documentation", label: "Documentation" },
];

export function Shell() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="10" width="16" height="10" rx="2" stroke="#3b82f6" strokeWidth="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="#3b82f6" strokeWidth="2" />
          </svg>
          <span>
            Gate Keeper
            <small>Admin Dashboard</small>
          </span>
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            {item.label}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={onLogout}>
          Sign out
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
