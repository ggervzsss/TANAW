import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { LoginPage } from "../../features/login/components/LoginPage";
import { useAuthStore } from "../../features/login/stores/auth-store";
import { EnterpriseShell } from "../layouts/EnterpriseShell";
import { routePaths } from "./routePaths";

type RequireAuthProps = {
  children: ReactNode;
};

function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  if (!isAuthenticated) {
    return <Navigate to={routePaths.login} replace state={{ from: location }} />;
  }

  if (!user || user.role !== "enterprise") {
    return <Navigate to={routePaths.login} replace />;
  }

  return children;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path={routePaths.home} element={<Navigate to={routePaths.enterpriseDashboard} replace />} />
      <Route path={routePaths.login} element={<LoginPage />} />
      <Route
        path={routePaths.enterprise}
        element={
          <RequireAuth>
            <EnterpriseShell initialView="dashboard" />
          </RequireAuth>
        }
      />
      <Route
        path={routePaths.enterpriseDashboard}
        element={
          <RequireAuth>
            <EnterpriseShell initialView="dashboard" />
          </RequireAuth>
        }
      />
      <Route
        path={routePaths.enterpriseCameras}
        element={
          <RequireAuth>
            <EnterpriseShell initialView="cameras" />
          </RequireAuth>
        }
      />
      <Route
        path={routePaths.enterpriseReports}
        element={
          <RequireAuth>
            <EnterpriseShell initialView="reports" />
          </RequireAuth>
        }
      />
      <Route
        path={routePaths.enterpriseSimulation}
        element={
          <RequireAuth>
            <EnterpriseShell initialView="simulation" />
          </RequireAuth>
        }
      />
      <Route
        path={routePaths.enterpriseProfile}
        element={
          <RequireAuth>
            <EnterpriseShell initialView="profile" />
          </RequireAuth>
        }
      />
      <Route
        path={routePaths.enterpriseSecurity}
        element={
          <RequireAuth>
            <EnterpriseShell initialView="security" />
          </RequireAuth>
        }
      />
      <Route
        path={routePaths.enterpriseNotifications}
        element={
          <RequireAuth>
            <EnterpriseShell initialView="notifications" />
          </RequireAuth>
        }
      />
      <Route
        path={routePaths.enterpriseTickets}
        element={
          <RequireAuth>
            <EnterpriseShell initialView="tickets" />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to={routePaths.enterpriseDashboard} replace />} />
    </Routes>
  );
}
