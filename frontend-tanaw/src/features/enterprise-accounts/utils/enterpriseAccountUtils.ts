import type { AccountSummary } from "@/shared/services/accountManagement";
import type { EnterpriseStatusFilter, LocationDraft } from "../types";

export function filterEnterpriseAccounts(accounts: AccountSummary[], query: string, status: EnterpriseStatusFilter, barangay: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return accounts.filter((enterprise) => {
    const haystack = `${enterprise.enterpriseName ?? enterprise.displayName} ${enterprise.managerName ?? ""} ${enterprise.category ?? ""} ${enterprise.barangay ?? ""}`.toLowerCase();
    return haystack.includes(normalizedQuery) && (status === "all" || enterprise.status === status) && (barangay === "All Barangays" || enterprise.barangay === barangay);
  });
}

export function getLocationSummary(location: LocationDraft) {
  return `Marker at ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
}
