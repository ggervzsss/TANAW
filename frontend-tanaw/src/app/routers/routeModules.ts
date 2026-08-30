import { lazy } from "react";
import type { UserRole } from "@/shared/types/role.types";
import { routes } from "./routes";

const modules = {
  account: () => import("@/features/account"),
  alerts: () => import("@/features/alerts-monitor"),
  analytics: () => import("@/features/analytics"),
  dashboard: () => import("@/features/dashboard"),
  devLog: () => import("@/features/dev-log"),
  enterpriseAccounts: () => import("@/features/enterprise-accounts"),
  lguAccounts: () => import("@/features/lgu-accounts"),
  login: () => import("@/features/login"),
  mapView: () => import("@/features/mapview"),
  notifications: () => import("@/features/notifications"),
  reports: () => import("@/features/reports"),
  systemLogs: () => import("@/features/system-logs"),
  systemSettings: () => import("@/features/system-settings"),
} as const;

export const AccountProfilePage = lazy(() => modules.account().then((module) => ({ default: module.AccountProfilePage })));
export const AccountSecurityPage = lazy(() => modules.account().then((module) => ({ default: module.AccountSecurityPage })));
export const AdminOperationsCenterPage = lazy(() => modules.alerts().then((module) => ({ default: module.AdminOperationsCenterPage })));
export const ITWorkCenterPage = lazy(() => modules.alerts().then((module) => ({ default: module.ITWorkCenterPage })));
export const StaffAnalyticsPage = lazy(() => modules.analytics().then((module) => ({ default: module.StaffAnalyticsPage })));
export const ITDashboardPage = lazy(() => modules.dashboard().then((module) => ({ default: module.ITDashboardPage })));
export const ITDevLogPage = import.meta.env.DEV ? lazy(() => modules.devLog().then((module) => ({ default: module.ITDevLogPage }))) : null;
export const ITEnterpriseAccountsPage = lazy(() => modules.enterpriseAccounts().then((module) => ({ default: module.ITEnterpriseAccountsPage })));
export const ITLguAccountsPage = lazy(() => modules.lguAccounts().then((module) => ({ default: module.ITLguAccountsPage })));
export const ActivateAccountPage = lazy(() => modules.login().then((module) => ({ default: module.ActivateAccountPage })));
export const EnterpriseAccessPage = lazy(() => modules.login().then((module) => ({ default: module.EnterpriseAccessPage })));
export const LoginPage = lazy(() => modules.login().then((module) => ({ default: module.LoginPage })));
export const VerifyEmailChangePage = lazy(() => modules.login().then((module) => ({ default: module.VerifyEmailChangePage })));
export const AdminMapViewPage = lazy(() => modules.mapView().then((module) => ({ default: module.AdminMapViewPage })));
export const NotificationsPage = lazy(() => modules.notifications().then((module) => ({ default: module.NotificationsPage })));
export const StaffBatchReportsPage = lazy(() => modules.reports().then((module) => ({ default: module.StaffBatchReportsPage })));
export const StaffFinalReportsAuditPage = lazy(() => modules.reports().then((module) => ({ default: module.StaffFinalReportsAuditPage })));
export const ITSystemSettingsPage = lazy(() => modules.systemSettings().then((module) => ({ default: module.ITSystemSettingsPage })));
export const AdminActivityHistoryPage = lazy(() => modules.systemLogs().then((module) => ({ default: module.AdminActivityHistoryPage })));
export const ITSystemLogsPage = lazy(() => modules.systemLogs().then((module) => ({ default: module.ITSystemLogsPage })));

const portalModuleByPath: Partial<Record<string, () => Promise<unknown>>> = {
  [routes.admin.activityHistory]: modules.systemLogs,
  [routes.admin.mapview]: modules.mapView,
  [routes.admin.notifications]: modules.notifications,
  [routes.admin.operations]: modules.alerts,
  [routes.admin.profile]: modules.account,
  [routes.admin.security]: modules.account,
  [routes.it.dashboard]: modules.dashboard,
  [routes.it.enterpriseAccounts]: modules.enterpriseAccounts,
  [routes.it.lguAccounts]: modules.lguAccounts,
  [routes.it.notifications]: modules.notifications,
  [routes.it.profile]: modules.account,
  [routes.it.security]: modules.account,
  [routes.it.systemLogs]: modules.systemLogs,
  [routes.it.systemSettings]: modules.systemSettings,
  [routes.it.workCenter]: modules.alerts,
  [routes.staff.analytics]: modules.analytics,
  [routes.staff.batchReports]: modules.reports,
  [routes.staff.finalReportsAudit]: modules.reports,
  [routes.staff.notifications]: modules.notifications,
  [routes.staff.profile]: modules.account,
  [routes.staff.security]: modules.account,
};

if (import.meta.env.DEV) portalModuleByPath[routes.it.devLog] = modules.devLog;

const authorizedPaths: Partial<Record<UserRole, string[]>> = {
  admin: Object.values(routes.admin),
  it: Object.values(routes.it).filter((path) => import.meta.env.DEV || path !== routes.it.devLog),
  staff: Object.values(routes.staff),
};

export function preloadPortalRoute(path: string) {
  return portalModuleByPath[path]?.().then(() => undefined) ?? Promise.resolve();
}

export function scheduleAuthorizedRoutePreload(role: UserRole, activePath: string) {
  const preload = () => {
    for (const path of authorizedPaths[role] ?? []) {
      if (path !== activePath) void preloadPortalRoute(path);
    }
  };
  const idleWindow = window as Window & {
    cancelIdleCallback?: (handle: number) => void;
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(preload, { timeout: 1800 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.requestAnimationFrame(preload);
  return () => window.cancelAnimationFrame(handle);
}
