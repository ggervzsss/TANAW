import type { UserRole } from "@/shared/types/role.types";
import type { NavigationItem } from "./navigation";
import { roleNavigation } from "./navigation";

export type TopbarEntry = { type: "link"; item: NavigationItem } | { type: "menu"; id: string; label: string; icon: NavigationItem["icon"]; children: NavigationItem[] };

export function getPortalNavigation(role: UserRole, showDevLog: boolean) {
  const navigation = roleNavigation[role] ?? [];
  return role === "it" && !showDevLog ? navigation.filter((item) => item.id !== "dev-log") : navigation;
}

/** Every portal shows its screens as one row of links; IT has four: Requests, Enterprises, LGU Personnel and System. */
export function getTopbarEntries(_role: UserRole, navigation: NavigationItem[]): TopbarEntry[] {
  return navigation.map((item) => ({ type: "link", item }));
}
