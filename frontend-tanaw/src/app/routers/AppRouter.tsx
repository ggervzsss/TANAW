import { Navigate, Route, Routes } from "react-router-dom";
import { AccountProfilePage, AccountSecurityPage } from "@/features/account";
import { AdminAlertsMonitorPage, ITAlertsPage } from "@/features/alerts-monitor";
import { StaffAnalyticsPage } from "@/features/analytics";
import { ITDashboardPage } from "@/features/dashboard";
import { ITDevLogPage } from "@/features/dev-log";
import { ITEmailDeliveriesPage } from "@/features/email-deliveries";
import { ITEnterpriseAccountsPage } from "@/features/enterprise-accounts";
import { ITLguAccountsPage } from "@/features/lgu-accounts";
import { ActivateAccountPage, EnterpriseAccessPage, LoginPage, VerifyEmailChangePage } from "@/features/login";
import { AdminMapViewPage } from "@/features/mapview";
import { NotificationsPage } from "@/features/notifications";
import { StaffBatchReportsPage, StaffFinalReportsAuditPage } from "@/features/reports";
import { ITSystemSettingsPage } from "@/features/system-settings";
import { AdminSystemLogsPage, ITSystemLogsPage, StaffSystemLogsPage } from "@/features/system-logs";
import { SupportTicketsPage } from "@/features/support-tickets";
import { AccountLayout } from "@/shared/components/layout";
import { getRoleDashboardPath } from "@/shared/utils/routeUtils";
import { useAuthStore } from "../store/authStore";
import { ProtectedRoute } from "./ProtectedRoute";
import { routes } from "./routes";

function RootRedirect() {
  const user = useAuthStore((state) => state.user);
  return <Navigate to={user ? getRoleDashboardPath(user.role) : routes.login} replace />;
}

export function AppRouter() {
  return (
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
  );
}
