import { lazy, Suspense, useEffect, type ReactNode } from "react";
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

let rendererReadySignaled = false;

function waitForCriticalAuthBackground() {
  const loginStage = document.querySelector<HTMLElement>("[data-auth-background-ready]");
  if (!loginStage || loginStage.dataset.authBackgroundReady === "true") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      if (loginStage.dataset.authBackgroundReady !== "true") return;
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve();
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 10_000);
    observer.observe(loginStage, {
      attributeFilter: ["data-auth-background-ready"],
      attributes: true,
    });
  });
}

function RendererReadyBoundary({ children }: RequireAuthProps) {
  useEffect(() => {
    if (rendererReadySignaled) return;

    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    let disposed = false;

    void waitForCriticalAuthBackground().then(() => {
      if (disposed) return;
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (disposed || rendererReadySignaled) return;
          rendererReadySignaled = true;
          window.tanawStartup?.ready();
        });
      });
    });

    return () => {
      disposed = true;
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  return children;
}

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
        <Route
          path={routePaths.login}
          element={
            <RendererReadyBoundary>
              <LoginPage />
            </RendererReadyBoundary>
          }
        />
        <Route
          path={routePaths.enterprise}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="dashboard" />
              </RendererReadyBoundary>
            </RequireAuth>
          }
        />
        <Route
          path={routePaths.enterpriseDashboard}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="dashboard" />
              </RendererReadyBoundary>
            </RequireAuth>
          }
        />
        <Route
          path={routePaths.enterpriseCameras}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="cameras" />
              </RendererReadyBoundary>
            </RequireAuth>
          }
        />
        <Route
          path={routePaths.enterpriseReports}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="reports" />
              </RendererReadyBoundary>
            </RequireAuth>
          }
        />
        <Route
          path={routePaths.enterpriseProfile}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="profile" />
              </RendererReadyBoundary>
            </RequireAuth>
          }
        />
        <Route
          path={routePaths.enterpriseSecurity}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="security" />
              </RendererReadyBoundary>
            </RequireAuth>
          }
        />
        <Route
          path={routePaths.enterpriseNotifications}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="notifications" />
              </RendererReadyBoundary>
            </RequireAuth>
          }
        />
        <Route
          path={routePaths.enterpriseTickets}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="tickets" />
              </RendererReadyBoundary>
            </RequireAuth>
          }
        />
        <Route
          path={routePaths.enterpriseDisplayPreferences}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="display-preferences" />
              </RendererReadyBoundary>
            </RequireAuth>
          }
        />
        <Route
          path={routePaths.enterpriseHelp}
          element={
            <RequireAuth>
              <RendererReadyBoundary>
                <EnterpriseShell initialView="help" />
              </RendererReadyBoundary>
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
