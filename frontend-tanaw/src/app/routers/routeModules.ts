import { lazy } from "react";
import type { UserRole } from "@/shared/types/role.types";
import { routes } from "./routes";

const modules = {
  settings: () => import("@/features/account/pages/GeneralSettingsPage"),
  adminDashboard: () => import("@/features/admin-dashboard"),
  adminEnterprises: () => import("@/features/admin-enterprises"),
  adminReports: () => import("@/features/admin-reports"),
  alerts: () => import("@/features/alerts-monitor"),
  devLog: () => import("@/features/dev-log"),
  itEnterprises: () => import("@/features/it-enterprises"),
  itOverview: () => import("@/features/it-overview"),
  itPersonnel: () => import("@/features/it-personnel"),
  itRequests: () => import("@/features/it-requests"),
  itSystem: () => import("@/features/it-system"),
  login: () => import("@/features/login"),
  notifications: () => import("@/features/notifications"),
  reports: () => import("@/features/reports"),
  systemLogs: () => import("@/features/system-logs"),
  helpCenter: () => import("@/features/help-center"),
} as const;

export const GeneralSettingsPage = lazy(() => modules.settings().then((module) => ({ default: module.GeneralSettingsPage })));
export const AdminDashboardPage = lazy(() => modules.adminDashboard().then((module) => ({ default: module.AdminDashboardPage })));
export const RegisteredEnterprisesPage = lazy(() => modules.adminEnterprises().then((module) => ({ default: module.RegisteredEnterprisesPage })));
export const EnterpriseDetailsPage = lazy(() => modules.adminEnterprises().then((module) => ({ default: module.EnterpriseDetailsPage })));
export const AdminEnterpriseReportsPage = lazy(() => modules.adminReports().then((module) => ({ default: module.AdminEnterpriseReportsPage })));
export const AdminRecentActivityPage = lazy(() => modules.systemLogs().then((module) => ({ default: module.AdminRecentActivityPage })));
export const AdminRequestsPage = lazy(() => modules.alerts().then((module) => ({ default: module.AdminRequestsPage })));
export const ITOverviewPage = lazy(() => modules.itOverview().then((module) => ({ default: module.ITOverviewPage })));
export const ITRequestsPage = lazy(() => modules.itRequests().then((module) => ({ default: module.ITRequestsPage })));
export const ITEnterprisesPage = lazy(() => modules.itEnterprises().then((module) => ({ default: module.ITEnterprisesPage })));
export const ITEnterpriseManagePage = lazy(() => modules.itEnterprises().then((module) => ({ default: module.ITEnterpriseManagePage })));
export const ITPersonnelPage = lazy(() => modules.itPersonnel().then((module) => ({ default: module.ITPersonnelPage })));
export const ITSystemPage = lazy(() => modules.itSystem().then((module) => ({ default: module.ITSystemPage })));
export const ITDevLogPage = import.meta.env.DEV ? lazy(() => modules.devLog().then((module) => ({ default: module.ITDevLogPage }))) : null;
export const ActivateAccountPage = lazy(() => modules.login().then((module) => ({ default: module.ActivateAccountPage })));
export const EnterpriseAccessPage = lazy(() => modules.login().then((module) => ({ default: module.EnterpriseAccessPage })));
export const LoginPage = lazy(() => modules.login().then((module) => ({ default: module.LoginPage })));
export const VerifyEmailChangePage = lazy(() => modules.login().then((module) => ({ default: module.VerifyEmailChangePage })));
export const NotificationsPage = lazy(() => modules.notifications().then((module) => ({ default: module.NotificationsPage })));
export const StaffReportsPage = lazy(() => modules.reports().then((module) => ({ default: module.StaffReportsPage })));
export const StaffConsolidatedReportsPage = lazy(() => modules.reports().then((module) => ({ default: module.StaffConsolidatedReportsPage })));
export const HelpCenterPage = lazy(() => modules.helpCenter().then((module) => ({ default: module.HelpCenterPage })));

const portalModuleByPath: Partial<Record<string, () => Promise<unknown>>> = {
  [routes.admin.dashboard]: modules.adminDashboard,
  [routes.admin.enterprises]: modules.adminEnterprises,
  [routes.admin.reports]: modules.adminReports,
  [routes.admin.activity]: modules.systemLogs,
  [routes.admin.requests]: modules.alerts,
  [routes.admin.generalSettings]: modules.settings,
  [routes.it.dashboard]: modules.itOverview,
  [routes.it.requests]: modules.itRequests,
  [routes.it.enterprises]: modules.itEnterprises,
  [routes.it.personnel]: modules.itPersonnel,
  [routes.it.system]: modules.itSystem,
  [routes.it.notifications]: modules.notifications,
  [routes.it.generalSettings]: modules.settings,
  [routes.staff.reports]: modules.reports,
  [routes.staff.consolidatedReports]: modules.reports,
  [routes.staff.notifications]: modules.notifications,
  [routes.staff.generalSettings]: modules.settings,
};

if (import.meta.env.DEV) portalModuleByPath[routes.it.devLog] = modules.devLog;

const authorizedPaths: Partial<Record<UserRole, string[]>> = {
  admin: Object.values(routes.admin).filter((path) => !path.includes(":")),
  it: Object.values(routes.it).filter((path) => !path.includes(":") && (import.meta.env.DEV || path !== routes.it.devLog)),
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
