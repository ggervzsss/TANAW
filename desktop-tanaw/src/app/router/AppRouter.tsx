import { MotionConfig } from "motion/react";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { matchPath, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuthStore } from "../../features/login/stores/auth-store";
import { ViewSkeleton } from "../../ui-kit/patterns/ViewSkeleton";
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
    <MotionConfig reducedMotion="user">
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
                  <EnterpriseShell activeView="dashboard" />
                </RendererReadyBoundary>
              </RequireAuth>
            }
          />
          <Route
            path={routePaths.enterpriseDashboard}
            element={
              <RequireAuth>
                <RendererReadyBoundary>
                  <EnterpriseShell activeView="dashboard" />
                </RendererReadyBoundary>
              </RequireAuth>
            }
          />
          <Route
            path={routePaths.enterpriseCameras}
            element={
              <RequireAuth>
                <RendererReadyBoundary>
                  <EnterpriseShell activeView="cameras" />
                </RendererReadyBoundary>
              </RequireAuth>
            }
          />
          <Route
            path={routePaths.enterpriseReports}
            element={
              <RequireAuth>
                <RendererReadyBoundary>
                  <EnterpriseShell activeView="reports" />
                </RendererReadyBoundary>
              </RequireAuth>
            }
          />
          <Route
            path={routePaths.enterpriseSettings + "/:section?"}
            element={
              <RequireAuth>
                <RendererReadyBoundary>
                  <EnterpriseShell activeView="settings" />
                </RendererReadyBoundary>
              </RequireAuth>
            }
          />
          <Route path="/enterprise/profile" element={<Navigate to={routePaths.enterpriseProfile} replace />} />
          <Route path="/enterprise/security" element={<Navigate to={routePaths.enterpriseSecurity} replace />} />
          <Route
            path={routePaths.enterpriseNotifications}
            element={
              <RequireAuth>
                <RendererReadyBoundary>
                  <EnterpriseShell activeView="notifications" />
                </RendererReadyBoundary>
              </RequireAuth>
            }
          />
          <Route path="/enterprise/tickets" element={<Navigate to={routePaths.enterpriseTickets} replace />} />
          <Route path="/enterprise/display-preferences" element={<Navigate to={routePaths.enterpriseSettings + "/appearance"} replace />} />
          <Route path="/enterprise/developer-settings" element={<Navigate to={routePaths.enterpriseDeveloperSettings} replace />} />
          <Route
            path={routePaths.enterpriseHelp}
            element={
              <RequireAuth>
                <RendererReadyBoundary>
                  <EnterpriseShell activeView="help" />
                </RendererReadyBoundary>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to={routePaths.enterpriseDashboard} replace />} />
        </Routes>
      </Suspense>
    </MotionConfig>
  );
}

/**
 * Shown while the session is checked or route code loads. Only a signed-in user on a workspace
 * route sees the app frame in outline; while the session is unknown, or on the sign-in route, a
 * plain page stands in, so the sign-in screen is never preceded by a workspace topbar it lacks.
 */
function RouteLoadingFallback() {
  const { pathname } = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const showWorkspaceFrame = isAuthenticated && matchPath(`${routePaths.enterprise}/*`, pathname) !== null;

  if (!showWorkspaceFrame) {
    return <div role="status" aria-label="Loading TANAW" aria-busy="true" className="h-svh bg-(--tanaw-page)" />;
  }

  // The page colour shows at once; the topbar band and outline wait with the skeleton screen's
  // short delay, so a quick load goes straight to the real page without a flash.
  return (
    <div className="h-svh overflow-hidden bg-(--tanaw-page)">
      <div className="tanaw-skeleton-screen flex h-full flex-col">
        <div aria-hidden="true" className="h-(--tanaw-topbar-height) shrink-0 bg-(image:--tanaw-topbar-gradient)" />
        <div className="min-h-0 flex-1 p-8 max-xl:p-6 max-sm:p-4">
          <ViewSkeleton variant="dashboard" label="Loading TANAW workspace" className="max-w-470 animate-none" />
        </div>
      </div>
    </div>
  );
}
