import { lazy } from "react";
import type { EnterpriseView } from "../../types/enterprise";

const settingsModule = () => import("../../features/preferences/GeneralSettingsView");

const viewModules = {
  cameras: () => import("../../features/camera/components/CameraManagementView"),
  dashboard: () => import("../../features/dashboard/components/DashboardView"),
  notifications: () => import("../../features/notifications/components/NotificationsView"),
  profile: settingsModule,
  reports: () => import("../../features/reports/components/ReportsView"),
  security: settingsModule,
  tickets: settingsModule,
  settings: settingsModule,
  help: () => import("../../features/help/components/HelpCenterView"),
} as const;

export const CameraManagementView = lazy(() => viewModules.cameras().then((module) => ({ default: module.CameraManagementView })));
export const DashboardView = lazy(() => viewModules.dashboard().then((module) => ({ default: module.DashboardView })));
export const NotificationsView = lazy(() => viewModules.notifications().then((module) => ({ default: module.NotificationsView })));
export const ReportsView = lazy(() => viewModules.reports().then((module) => ({ default: module.ReportsView })));
export const GeneralSettingsView = lazy(() => settingsModule().then((module) => ({ default: module.GeneralSettingsView })));
export const HelpCenterView = lazy(() => viewModules.help().then((module) => ({ default: module.HelpCenterView })));

export function preloadEnterpriseView(view: EnterpriseView) {
  return viewModules[view]().then(() => undefined);
}

export function scheduleEnterpriseViewPreload(activeView: EnterpriseView) {
  const preload = () => {
    for (const view of Object.keys(viewModules) as EnterpriseView[]) {
      if (view !== activeView) void preloadEnterpriseView(view);
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
