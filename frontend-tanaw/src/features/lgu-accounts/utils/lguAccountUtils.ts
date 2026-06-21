import type { AccountSummary } from "@/shared/services/accountManagement";
import type { LguRoleFilter, LguStatusFilter } from "../types";

export const lguRoleLabel: Record<string, string> = {
  admin: "Admin",
  it: "IT Personnel",
  staff: "LGU Staff",
};

export function filterLguAccounts(accounts: AccountSummary[], query: string, role: LguRoleFilter, status: LguStatusFilter) {
  const normalizedQuery = query.trim().toLowerCase();

  return accounts.filter((account) => {
    const haystack = `${account.displayName} ${account.email}`.toLowerCase();
    return haystack.includes(normalizedQuery) && (role === "all" || account.role === role) && account.status === status;
  });
}
