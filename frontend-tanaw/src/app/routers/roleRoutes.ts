import { matchPath, parsePath } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import type { UserRole } from "@/shared/types/role.types";

export function getRoleDashboardPath(role: UserRole): string {
  if (role === "admin") return routes.admin.dashboard;
  if (role === "staff") return routes.staff.reports;
  if (role === "enterprise") return routes.enterpriseAccess;
  return routes.it.dashboard;
}

export function getRoleSettingsPath(role: UserRole): string {
  if (role === "admin") return routes.admin.generalSettings;
  if (role === "staff") return routes.staff.generalSettings;
  return routes.it.generalSettings;
}

export function isRoleSettingsPath(role: UserRole, pathname: string): boolean {
  return matchPath(`${getRoleSettingsPath(role)}/*`, pathname) !== null;
}

export function getRoleSettingsBackPath(role: Exclude<UserRole, "enterprise">, returnTo: unknown): string {
  if (typeof returnTo === "string") {
    const { pathname } = parsePath(returnTo);
    const portal = routes[role];
    if (pathname && !isRoleSettingsPath(role, pathname) && (Object.values(portal).some((path) => matchPath(path, pathname)) || matchPath(`${portal.help}/:articleId`, pathname))) {
      return returnTo;
    }
  }
  return getRoleDashboardPath(role);
}

export function getRoleHelpPath(role: UserRole): string {
  if (role === "admin") return routes.admin.help;
  if (role === "staff") return routes.staff.help;
  return routes.it.help;
}
