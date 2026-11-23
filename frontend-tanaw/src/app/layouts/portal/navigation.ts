import { Building2, FileCheck2, FileText, Layers, LayoutDashboard, Settings, Users, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import { routes } from "@/app/routers/routes";
import type { UserRole } from "@/shared/types/role.types";

export type NavigationItem = {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Other pages that belong to this item, so it stays highlighted on them. */
  alsoActiveOn?: readonly string[];
};

export const roleNavigation: Record<UserRole, NavigationItem[]> = {
  admin: [
    {
      id: "dashboard",
      label: "Dashboard",
      path: routes.admin.dashboard,
      icon: LayoutDashboard,
      alsoActiveOn: [routes.admin.activity, routes.admin.requests],
    },
    {
      id: "enterprises",
      label: "Enterprise",
      path: routes.admin.enterprises,
      icon: Building2,
    },
    {
      id: "reports",
      label: "Reports",
      path: routes.admin.reports,
      icon: FileText,
    },
  ],
  staff: [
    {
      id: "reports",
      label: "Reports",
      path: routes.staff.reports,
      icon: Layers,
    },
    {
      id: "consolidated-reports",
      label: "Consolidated Reports",
      path: routes.staff.consolidatedReports,
      icon: FileCheck2,
    },
  ],
  it: [
    {
      id: "dashboard",
      label: "Overview",
      path: routes.it.dashboard,
      icon: LayoutDashboard,
    },
    {
      id: "work-center",
      label: "Work Center",
      path: routes.it.workCenter,
      icon: Wrench,
    },
    {
      id: "lgu-accounts",
      label: "LGU Personnel",
      path: routes.it.lguAccounts,
      icon: Users,
    },
    {
      id: "enterprise-accounts",
      label: "Enterprises",
      path: routes.it.enterpriseAccounts,
      icon: Building2,
    },
    {
      id: "system-logs",
      label: "System Activity",
      path: routes.it.systemLogs,
      icon: FileText,
    },
    {
      id: "system-settings",
      label: "System Settings",
      path: routes.it.systemSettings,
      icon: Settings,
    },
  ],
  enterprise: [],
};
