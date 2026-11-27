import { Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AccountLayout } from "@/app/layouts/portal";
import { getRoleDashboardPath } from "@/app/routers/roleRoutes";
import { ViewSkeleton } from "@/shared/ui-kit/patterns/ViewSkeleton";
import { useAuthStore } from "../store/authStore";
import { ProtectedRoute } from "./ProtectedRoute";
import { legacyPortalRedirects, routes } from "./routes";
import {
  GeneralSettingsPage,
  HelpCenterPage,
  ActivateAccountPage,
  AdminDashboardPage,
  AdminEnterpriseReportsPage,
  AdminRecentActivityPage,
  AdminRequestsPage,
  EnterpriseAccessPage,
  EnterpriseDetailsPage,
  ITDevLogPage,
  ITEnterpriseManagePage,
  ITEnterprisesPage,
  ITOverviewPage,
  ITPersonnelPage,
  ITRequestsPage,
  ITSystemPage,
  LoginPage,
  NotificationsPage,
  RegisteredEnterprisesPage,
  StaffConsolidatedReportsPage,
  StaffReportsPage,
  VerifyEmailChangePage,
} from "./routeModules";

function RootRedirect() {
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  if (status === "checking") return <RouteLoadingFallback />;
  return <Navigate to={user ? getRoleDashboardPath(user.role) : routes.login} replace />;
}

export function AppRouter() {
  const status = useAuthStore((state) => state.status);

  if (status === "checking") return <RouteLoadingFallback />;

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path={routes.home} element={<RootRedirect />} />
        <Route path={routes.login} element={<LoginPage />} />
        <Route path={routes.activateAccount} element={<ActivateAccountPage />} />
        <Route path={routes.verifyEmailChange} element={<VerifyEmailChangePage />} />
        <Route path={routes.enterpriseAccess} element={<EnterpriseAccessPage />} />

        <Route
          path={routes.it.root}
          element={
            <ProtectedRoute allowedRoles={["it"]}>
              <AccountLayout role="it" />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to={routes.it.dashboard} replace />} />
          <Route path="dashboard" element={<ITOverviewPage />} />
          <Route path="requests" element={<ITRequestsPage />} />
          <Route path="enterprises" element={<ITEnterprisesPage />} />
          <Route path="enterprises/:enterpriseId" element={<ITEnterpriseManagePage />} />
          <Route path="personnel" element={<ITPersonnelPage />} />
          <Route path="system" element={<ITSystemPage />} />
          <Route path="notifications" element={<NotificationsPage role="it" />} />
          {legacyPortalRedirects.it.map(([path, target]) => (
            <Route key={path} path={path} element={<LegacyRedirect to={target} />} />
          ))}
          {import.meta.env.DEV && ITDevLogPage ? <Route path="dev-log" element={<ITDevLogPage />} /> : null}
          <Route path="settings/:section?" element={<GeneralSettingsPage role="it" />} />
          <Route path="profile" element={<Navigate to={routes.it.profile} replace />} />
          <Route path="security" element={<Navigate to={routes.it.security} replace />} />
          <Route path="display-preferences" element={<Navigate to={routes.it.displayPreferences} replace />} />
          <Route path="help" element={<HelpCenterPage role="it" />} />
          <Route path="help/:articleId" element={<HelpCenterPage role="it" />} />
        </Route>

        <Route
          path={routes.admin.root}
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AccountLayout role="admin" />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to={routes.admin.dashboard} replace />} />
          <Route path="dashboard" element={<AdminDashboardPage />} />
          <Route path="enterprises" element={<RegisteredEnterprisesPage />} />
          <Route path="enterprises/:enterpriseId" element={<EnterpriseDetailsPage />} />
          <Route path="reports" element={<AdminEnterpriseReportsPage />} />
          <Route path="activity" element={<AdminRecentActivityPage />} />
          <Route path="requests" element={<AdminRequestsPage />} />
          {legacyPortalRedirects.admin.map(([path, target]) => (
            <Route key={path} path={path} element={<Navigate to={target} replace />} />
          ))}
          <Route path="settings/:section?" element={<GeneralSettingsPage role="admin" />} />
          <Route path="profile" element={<Navigate to={routes.admin.profile} replace />} />
          <Route path="security" element={<Navigate to={routes.admin.security} replace />} />
          <Route path="display-preferences" element={<Navigate to={routes.admin.displayPreferences} replace />} />
          <Route path="help" element={<HelpCenterPage role="admin" />} />
          <Route path="help/:articleId" element={<HelpCenterPage role="admin" />} />
        </Route>

        <Route
          path={routes.staff.root}
          element={
            <ProtectedRoute allowedRoles={["staff"]}>
              <AccountLayout role="staff" />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to={routes.staff.reports} replace />} />
          <Route path="reports" element={<StaffReportsPage />} />
          <Route path="consolidated-reports" element={<StaffConsolidatedReportsPage />} />
          {legacyPortalRedirects.staff.map(([path, target]) => (
            <Route key={path} path={path} element={<Navigate to={target} replace />} />
          ))}
          <Route path="notifications" element={<NotificationsPage role="staff" />} />
          <Route path="settings/:section?" element={<GeneralSettingsPage role="staff" />} />
          <Route path="profile" element={<Navigate to={routes.staff.profile} replace />} />
          <Route path="security" element={<Navigate to={routes.staff.security} replace />} />
          <Route path="display-preferences" element={<Navigate to={routes.staff.displayPreferences} replace />} />
          <Route path="help" element={<HelpCenterPage role="staff" />} />
          <Route path="help/:articleId" element={<HelpCenterPage role="staff" />} />
        </Route>

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  );
}

/**
 * Sends an old IT address to its new screen and keeps its query, so links such as
 * `/it/work-center?request=REQ-1` still open the right request. The old Work Center email view
 * now lives under System, and its alerts view on the Overview.
 */
function LegacyRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  const [path, targetQuery = ""] = to.split("?");
  const params = new URLSearchParams(search);
  const view = params.get("view");
  params.delete("view");
  if (view === "email") return <Navigate to="/it/system?tab=email" replace />;
  if (view === "alerts") return <Navigate to={routes.it.dashboard} replace />;
  for (const [key, value] of new URLSearchParams(targetQuery)) params.set(key, value);
  const query = params.toString();
  return <Navigate to={query ? `${path}?${query}` : path} replace />;
}

/** Before the session is known or a screen's code arrives: a quiet page outline on the green wash. */
function RouteLoadingFallback() {
  return (
    <div className="tanaw-portal-content min-h-svh bg-(--tanaw-page) px-8 pt-12 max-xl:px-6 max-sm:px-4 max-sm:pt-8">
      <ViewSkeleton label="Loading TANAW workspace…" className="mx-auto max-w-420" />
    </div>
  );
}
