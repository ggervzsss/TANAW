import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AccountLayout } from "@/app/layouts/portal";
import { getRoleDashboardPath } from "@/app/routers/roleRoutes";
import { useAuthStore } from "../store/authStore";
import { ProtectedRoute } from "./ProtectedRoute";
import { routes } from "./routes";
import {
  GeneralSettingsPage,
  HelpCenterPage,
  ActivateAccountPage,
  AdminActivityHistoryPage,
  AdminMapViewPage,
  AdminVisitorInsightsPage,
  AdminOperationsCenterPage,
  EnterpriseAccessPage,
  ITDashboardPage,
  ITDevLogPage,
  ITEnterpriseAccountsPage,
  ITLguAccountsPage,
  ITSystemLogsPage,
  ITWorkCenterPage,
  LoginPage,
  NotificationsPage,
  StaffAnalyticsPage,
  StaffBatchReportsPage,
  StaffGeneratedReportsPage,
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
          <Route path="dashboard" element={<ITDashboardPage />} />
          <Route path="work-center" element={<ITWorkCenterPage />} />
          <Route path="lgu-accounts" element={<ITLguAccountsPage />} />
          <Route path="enterprise-accounts" element={<ITEnterpriseAccountsPage />} />
          <Route path="notifications" element={<NotificationsPage role="it" />} />
          <Route path="system-logs" element={<ITSystemLogsPage />} />
          {import.meta.env.DEV && ITDevLogPage ? <Route path="dev-log" element={<ITDevLogPage />} /> : null}
          <Route path="settings/:section?" element={<GeneralSettingsPage role="it" />} />
          <Route path="profile" element={<Navigate to={routes.it.profile} replace />} />
          <Route path="security" element={<Navigate to={routes.it.security} replace />} />
          <Route path="display-preferences" element={<Navigate to={routes.it.displayPreferences} replace />} />
          <Route path="system-settings" element={<Navigate to={routes.it.systemSettings} replace />} />
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
          <Route index element={<Navigate to={routes.admin.mapview} replace />} />
          <Route path="mapview" element={<AdminMapViewPage />} />
          <Route path="visitor-insights" element={<AdminVisitorInsightsPage />} />
          <Route path="activity-history" element={<AdminActivityHistoryPage />} />
          <Route path="operations" element={<AdminOperationsCenterPage />} />
          <Route path="notifications" element={<NotificationsPage role="admin" />} />
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
          <Route index element={<Navigate to={routes.staff.analytics} replace />} />
          <Route path="batch-reports" element={<StaffBatchReportsPage />} />
          <Route path="generated-reports" element={<StaffGeneratedReportsPage />} />
          <Route path="final-reports-audit" element={<Navigate to={routes.staff.generatedReports} replace />} />
          <Route path="analytics" element={<StaffAnalyticsPage />} />
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

function RouteLoadingFallback() {
  return (
    <div className="grid min-h-svh place-items-center bg-[#f4f8f5] text-sm font-semibold text-(--tanaw-green)" role="status">
      Loading TANAW workspace…
    </div>
  );
}
