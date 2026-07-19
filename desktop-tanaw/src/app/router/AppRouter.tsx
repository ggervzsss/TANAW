import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuthStore } from "../../features/login/stores/auth-store";
import { routePaths } from "./routePaths";

const LoginPage = lazy(() =>
  import("../../features/login/components/LoginPage").then((module) => ({
    default: module.LoginPage,
  })),
);
const EnterpriseShell = lazy(() => import("../layouts/EnterpriseShell").then((module) => ({ default: module.EnterpriseShell })));

type RequireAuthProps = {
  children: ReactNode;
};

function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);

  if (status === "checking") return <RouteLoadingFallback />;

  if (!isAuthenticated) {
    return <Navigate to={routePaths.login} replace state={{ from: location }} />;
  }

  if (!user || user.role !== "enterprise") {
    return <Navigate to={routePaths.login} replace />;
  }

  return children;
}

export function AppRouter() {
  const status = useAuthStore((state) => state.status);
  if (status === "checking") return <RouteLoadingFallback />;

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
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
    </Suspense>
  );
}

function RouteLoadingFallback() {
  return (
    <div className="grid h-svh place-items-center bg-[#f4f8f5] text-sm font-semibold text-[#064e3b] dark:bg-[#0f172a] dark:text-emerald-300" role="status">
      Loading TANAW workspace…
    </div>
  );
}
