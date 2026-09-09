import { routes } from "@/app/routers/routes";
import type { UserRole } from "@/shared/types/role.types";

export function getRoleDashboardPath(role: UserRole): string {
  if (role === "admin") return routes.admin.mapview;
  if (role === "staff") return routes.staff.analytics;
  if (role === "enterprise") return routes.enterpriseAccess;
  return routes.it.dashboard;
}

export function getRoleProfilePath(role: UserRole): string {
  if (role === "admin") return routes.admin.profile;
  if (role === "staff") return routes.staff.profile;
  return routes.it.profile;
}

export function getRoleSecurityPath(role: UserRole): string {
  if (role === "admin") return routes.admin.security;
  if (role === "staff") return routes.staff.security;
  return routes.it.security;
}

export function getRoleDisplayPreferencesPath(role: UserRole): string {
  if (role === "admin") return routes.admin.displayPreferences;
  if (role === "staff") return routes.staff.displayPreferences;
  return routes.it.displayPreferences;
}

export function getRoleHelpPath(role: UserRole): string {
  if (role === "admin") return routes.admin.help;
  if (role === "staff") return routes.staff.help;
  return routes.it.help;
}
