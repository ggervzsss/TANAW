import { BarChart3, Bell, Building2, FileCheck2, FileText, Inbox, Layers, LayoutDashboard, MapPinned, Settings, Users } from "lucide-react";
import type { ComponentType } from "react";
import { routes } from "@/app/routers/routes";
import type { UserRole } from "../../types/role.types";

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
      id: "system-logs",
      label: "System Logs",
      path: routes.admin.systemLogs,
      icon: FileText,
    },
    {
      id: "alerts-monitor",
      label: "Alerts & Monitor",
      path: routes.admin.alertsMonitor,
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
    {
      id: "system-logs",
      label: "Activity Logs",
      path: routes.staff.systemLogs,
      icon: FileText,
    },
  ],
  it: [
    {
      id: "dashboard",
      label: "Dashboard",
      path: routes.it.dashboard,
      icon: LayoutDashboard,
    },
    {
      id: "lgu-accounts",
      label: "LGU Accounts",
      path: routes.it.lguAccounts,
      icon: Users,
    },
    {
      id: "enterprise-accounts",
      label: "Enterprise Accounts",
      path: routes.it.enterpriseAccounts,
      icon: Building2,
    },
    {
      id: "alerts",
      label: "Alerts",
      path: routes.it.alerts,
      icon: Bell,
    },
    {
      id: "system-logs",
      label: "System Activity",
      path: routes.it.systemLogs,
      icon: FileText,
    },
    {
      id: "dev-log",
      label: "Dev Log",
      path: routes.it.devLog,
      icon: Inbox,
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

export const rolePortalLabel: Record<UserRole, string> = {
  admin: "Admin Portal",
  staff: "Staff Portal",
  it: "IT Portal",
  enterprise: "Enterprise Portal",
};

export const roleAccessLabel: Record<UserRole, string> = {
  admin: "Supervisory Access",
  staff: "Processing Access",
  it: "Technical Access",
  enterprise: "Enterprise Access",
};
