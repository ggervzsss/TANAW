import { Settings, Users } from "lucide-react";
import type { UserRole } from "@/shared/types/role.types";
import type { NavigationItem } from "./navigation";
import { roleNavigation } from "./navigation";

export type TopbarEntry = { type: "link"; item: NavigationItem } | { type: "menu"; id: string; label: string; icon: NavigationItem["icon"]; children: NavigationItem[] };

export function getPortalNavigation(role: UserRole, showDevLog: boolean) {
  const navigation = roleNavigation[role] ?? [];
  return role === "it" && !showDevLog ? navigation.filter((item) => item.id !== "dev-log") : navigation;
}

export function getTopbarEntries(role: UserRole, navigation: NavigationItem[]): TopbarEntry[] {
  if (role !== "it") return navigation.map((item) => ({ type: "link", item }));
  const getItem = (id: string) => navigation.find((entry) => entry.id === id);
  const entries: TopbarEntry[] = [];
  for (const id of ["dashboard", "work-center"]) {
    const item = getItem(id);
    if (item) entries.push({ type: "link", item });
  }
  const accounts = [getItem("lgu-accounts"), getItem("enterprise-accounts")].filter(Boolean) as NavigationItem[];
  const system = [getItem("system-logs"), getItem("system-settings"), getItem("dev-log")].filter(Boolean) as NavigationItem[];
  if (accounts.length) entries.push({ type: "menu", id: "accounts", label: "Accounts", icon: Users, children: accounts });
  if (system.length) entries.push({ type: "menu", id: "system", label: "System", icon: Settings, children: system });
  return entries;
}
