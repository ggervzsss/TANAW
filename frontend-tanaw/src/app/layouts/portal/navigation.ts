import { Building2, FileCheck2, FileText, Inbox, Layers, LayoutDashboard, Settings, Users } from "lucide-react";
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

/** A count shown beside a navigation label, such as the requests nobody has picked up yet. */
export type NavigationBadge = { count: number; label: string };

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
    { id: "dashboard", label: "Overview", path: routes.it.dashboard, icon: LayoutDashboard },
    { id: "requests", label: "Requests", path: routes.it.requests, icon: Inbox },
    { id: "enterprises", label: "Enterprises", path: routes.it.enterprises, icon: Building2 },
    { id: "personnel", label: "LGU Personnel", path: routes.it.personnel, icon: Users },
    { id: "system", label: "System", path: routes.it.system, icon: Settings },
  ],
  enterprise: [],
};
