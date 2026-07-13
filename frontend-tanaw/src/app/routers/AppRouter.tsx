import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AccountLayout } from "@/shared/components/layout";
import { getRoleDashboardPath } from "@/shared/utils/routeUtils";
import { useAuthStore } from "../store/authStore";
import { ProtectedRoute } from "./ProtectedRoute";
import { routes } from "./routes";

const AccountProfilePage = lazy(() => import("@/features/account").then((module) => ({ default: module.AccountProfilePage })));
const AccountSecurityPage = lazy(() => import("@/features/account").then((module) => ({ default: module.AccountSecurityPage })));
const AdminAlertsMonitorPage = lazy(() =>
  import("@/features/alerts-monitor").then((module) => ({
    default: module.AdminAlertsMonitorPage,
  })),
);
const ITAlertsPage = lazy(() => import("@/features/alerts-monitor").then((module) => ({ default: module.ITAlertsPage })));
const StaffAnalyticsPage = lazy(() => import("@/features/analytics").then((module) => ({ default: module.StaffAnalyticsPage })));
const ITDashboardPage = lazy(() => import("@/features/dashboard").then((module) => ({ default: module.ITDashboardPage })));
const ITDevLogPage = lazy(() => import("@/features/dev-log").then((module) => ({ default: module.ITDevLogPage })));
const ITEmailDeliveriesPage = lazy(() =>
  import("@/features/email-deliveries").then((module) => ({
    default: module.ITEmailDeliveriesPage,
  })),
);
const ITEnterpriseAccountsPage = lazy(() =>
  import("@/features/enterprise-accounts").then((module) => ({
    default: module.ITEnterpriseAccountsPage,
  })),
);
const ITLguAccountsPage = lazy(() => import("@/features/lgu-accounts").then((module) => ({ default: module.ITLguAccountsPage })));
const ActivateAccountPage = lazy(() => import("@/features/login").then((module) => ({ default: module.ActivateAccountPage })));
const EnterpriseAccessPage = lazy(() => import("@/features/login").then((module) => ({ default: module.EnterpriseAccessPage })));
const LoginPage = lazy(() => import("@/features/login").then((module) => ({ default: module.LoginPage })));
const VerifyEmailChangePage = lazy(() => import("@/features/login").then((module) => ({ default: module.VerifyEmailChangePage })));
const AdminMapViewPage = lazy(() => import("@/features/mapview").then((module) => ({ default: module.AdminMapViewPage })));
const NotificationsPage = lazy(() => import("@/features/notifications").then((module) => ({ default: module.NotificationsPage })));
const StaffBatchReportsPage = lazy(() => import("@/features/reports").then((module) => ({ default: module.StaffBatchReportsPage })));
const StaffFinalReportsAuditPage = lazy(() =>
  import("@/features/reports").then((module) => ({
    default: module.StaffFinalReportsAuditPage,
  })),
);
const ITSystemSettingsPage = lazy(() =>
  import("@/features/system-settings").then((module) => ({
    default: module.ITSystemSettingsPage,
  })),
);
const AdminSystemLogsPage = lazy(() => import("@/features/system-logs").then((module) => ({ default: module.AdminSystemLogsPage })));
const ITSystemLogsPage = lazy(() => import("@/features/system-logs").then((module) => ({ default: module.ITSystemLogsPage })));
const StaffSystemLogsPage = lazy(() => import("@/features/system-logs").then((module) => ({ default: module.StaffSystemLogsPage })));
const SupportTicketsPage = lazy(() =>
  import("@/features/support-tickets").then((module) => ({
    default: module.SupportTicketsPage,
  })),
);

function RootRedirect() {
  const user = useAuthStore((state) => state.user);
  return <Navigate to={user ? getRoleDashboardPath(user.role) : routes.login} replace />;
}

export function AppRouter() {
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
          <Route path="lgu-accounts" element={<ITLguAccountsPage />} />
          <Route path="enterprise-accounts" element={<ITEnterpriseAccountsPage />} />
          <Route path="alerts" element={<ITAlertsPage />} />
          <Route path="support-tickets" element={<SupportTicketsPage mode="it" />} />
          <Route path="notifications" element={<NotificationsPage role="it" />} />
          <Route path="system-logs" element={<ITSystemLogsPage />} />
          <Route path="email-deliveries" element={<ITEmailDeliveriesPage />} />
          <Route path="dev-log" element={<ITDevLogPage />} />
          <Route path="system-settings" element={<ITSystemSettingsPage />} />
          <Route path="profile" element={<AccountProfilePage role="it" />} />
          <Route path="security" element={<AccountSecurityPage />} />
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
          <Route path="system-logs" element={<AdminSystemLogsPage />} />
          <Route path="alerts-monitor" element={<AdminAlertsMonitorPage />} />
          <Route path="support-tickets" element={<SupportTicketsPage mode="admin" />} />
          <Route path="notifications" element={<NotificationsPage role="admin" />} />
          <Route path="profile" element={<AccountProfilePage role="admin" />} />
          <Route path="security" element={<AccountSecurityPage />} />
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
          <Route path="final-reports-audit" element={<StaffFinalReportsAuditPage />} />
          <Route path="analytics" element={<StaffAnalyticsPage />} />
          <Route path="notifications" element={<NotificationsPage role="staff" />} />
          <Route path="system-logs" element={<StaffSystemLogsPage />} />
          <Route path="profile" element={<AccountProfilePage role="staff" />} />
          <Route path="security" element={<AccountSecurityPage />} />
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
