import { matchPath, parsePath } from "react-router-dom";

export const routePaths = {
  home: "/",
  login: "/login",
  enterprise: "/enterprise",
  enterpriseDashboard: "/enterprise/dashboard",
  enterpriseCameras: "/enterprise/cameras",
  enterpriseReports: "/enterprise/reports",
  enterpriseSettings: "/enterprise/settings",
  enterpriseProfile: "/enterprise/settings/profile",
  enterpriseSecurity: "/enterprise/settings/security",
  enterpriseNotifications: "/enterprise/notifications",
  enterpriseTickets: "/enterprise/settings/support",
  enterpriseDeveloperSettings: "/enterprise/settings/developer",
  enterpriseHelp: "/enterprise/help",
} as const;

export function getEnterpriseSettingsBackPath(returnTo: unknown): string {
  if (typeof returnTo === "string") {
    const { pathname } = parsePath(returnTo);
    if (
      pathname &&
      matchPath(`${routePaths.enterprise}/*`, pathname) &&
      !matchPath(`${routePaths.enterpriseSettings}/*`, pathname) &&
      Object.values(routePaths).some((path) => matchPath(path, pathname))
    ) {
      return returnTo;
    }
  }
  return routePaths.enterpriseDashboard;
}
