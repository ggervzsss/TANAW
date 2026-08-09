import { BarChart3, Bell, Building2, FileCheck2, FileText, Layers, LayoutDashboard, MapPinned, Settings, Users, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import { routes } from "@/app/routers/routes";
import type { UserRole } from "@/shared/types/role.types";

export type NavigationItem = {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};

export const roleNavigation: Record<UserRole, NavigationItem[]> = {
  admin: [
    {
      id: "mapview",
      label: "Map View",
      path: routes.admin.mapview,
      icon: MapPinned,
    },
    {
      id: "activity-history",
      label: "Activity History",
      path: routes.admin.activityHistory,
      icon: FileText,
    },
    {
      id: "operations",
      label: "Operations Center",
      path: routes.admin.operations,
      icon: Bell,
    },
  ],
  staff: [
    {
      id: "analytics",
      label: "Dashboard",
      path: routes.staff.analytics,
      icon: BarChart3,
    },
    {
      id: "batch-reports",
      label: "Batch Reports",
      path: routes.staff.batchReports,
      icon: Layers,
    },
    {
      id: "final-reports-audit",
      label: "Final Reports Audit",
      path: routes.staff.finalReportsAudit,
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
