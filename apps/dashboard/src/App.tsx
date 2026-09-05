import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.js";
import { LoginPage } from "./auth/LoginPage.js";
import { Shell } from "./layout/Shell.js";
import { SiteProvider } from "./SiteContext.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { SitesPage } from "./pages/SitesPage.js";
import { SiteDetailPage } from "./pages/SiteDetailPage.js";
import { ChallengesPage } from "./pages/ChallengesPage.js";
import { VerificationEventsPage } from "./pages/VerificationEventsPage.js";
import { RiskAnalyticsPage } from "./pages/RiskAnalyticsPage.js";
import { RateLimitsPage } from "./pages/RateLimitsPage.js";
import { SecurityEventsPage } from "./pages/SecurityEventsPage.js";
import { AuditLogsPage } from "./pages/AuditLogsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { DocumentationPage } from "./pages/DocumentationPage.js";

function ProtectedShell() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <SiteProvider>
      <Shell />
    </SiteProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedShell />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/sites/:siteId" element={<SiteDetailPage />} />
        <Route path="/challenges" element={<ChallengesPage />} />
        <Route path="/verification-events" element={<VerificationEventsPage />} />
        <Route path="/risk-analytics" element={<RiskAnalyticsPage />} />
        <Route path="/rate-limits" element={<RateLimitsPage />} />
        <Route path="/security-events" element={<SecurityEventsPage />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/documentation" element={<DocumentationPage />} />
      </Route>
    </Routes>
  );
}
