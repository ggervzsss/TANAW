import { normalizeBarangayName } from "@/features/mapview/utils/barangayNames";
import type { MapEnterprise } from "@/shared/types";

/*
 * Which pins the dashboard map shows. The city view shows one pin per barangay, its busiest
 * enterprise right now (the "leader"); opening a barangay shows all of that barangay's enterprises.
 */

/** A barangay key that ignores case, accents and spelling variants, so "Pacita I" matches "Pacita 1". */
export function barangayKey(name: string) {
  return normalizeBarangayName(name || "Unassigned");
}

function liveCount(enterprise: MapEnterprise) {
  return enterprise.totalLiveOccupancy ?? -1;
}

/** The busiest enterprise in each barangay: most people inside now, then most visitors today, then A–Z. */
export function barangayLeaders(enterprises: readonly MapEnterprise[]) {
  const leaders = new Map<string, MapEnterprise>();
  for (const enterprise of enterprises) {
    const key = barangayKey(enterprise.barangay);
    const leader = leaders.get(key);
    if (!leader || compareBusiest(enterprise, leader) < 0) leaders.set(key, enterprise);
  }
  return [...leaders.values()];
}

function compareBusiest(left: MapEnterprise, right: MapEnterprise) {
  return liveCount(right) - liveCount(left) || (right.estimatedUniqueCount ?? -1) - (left.estimatedUniqueCount ?? -1) || left.name.localeCompare(right.name);
}

export function enterprisesInBarangay(enterprises: readonly MapEnterprise[], barangay: string) {
  const key = barangayKey(barangay);
  return enterprises.filter((enterprise) => barangayKey(enterprise.barangay) === key);
}

/** The pins on screen: every enterprise of an open barangay, otherwise each barangay's leader. */
export function visiblePins(enterprises: readonly MapEnterprise[], openBarangay: string | null) {
  return openBarangay ? enterprisesInBarangay(enterprises, openBarangay) : barangayLeaders(enterprises);
}

/** A pin's accessible name, which also says what selecting it does. */
export function pinAriaLabel(enterprise: MapEnterprise, options: { busy: boolean; leader: boolean; barangayCount: number }) {
  const parts = [`${enterprise.name}, Barangay ${enterprise.barangay || "Unassigned"}`];
  if (options.busy) parts.push("Busier than usual");
  if (options.leader && options.barangayCount > 1) parts.push("Busiest in its barangay", `Select to see all ${options.barangayCount} enterprises here`);
  else parts.push("Select to show its details link");
  return `${parts.join(". ")}.`;
}
