import { Building2 } from "lucide-react";
import { EmptyState, StatusBadge } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/services/accountManagement";

type EnterpriseAccountsTableProps = {
  accounts: AccountSummary[];
  filteredEnterprises: AccountSummary[];
  isLoading: boolean;
  onSelectEnterprise: (enterprise: AccountSummary) => void;
};

export function EnterpriseAccountsTable({ accounts, filteredEnterprises, isLoading, onSelectEnterprise }: EnterpriseAccountsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-220 table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[15%]" />
          <col className="w-[28%]" />
          <col className="w-[12%]" />
          <col className="w-[23%]" />
        </colgroup>
        <thead className="bg-gray-50 text-[11px] font-bold tracking-wider text-gray-500 uppercase">
          <tr>
            {["Enterprise", "Barangay", "Enterprise ID", "Status", "Contact / Created"].map((heading) => (
              <th key={heading} className="px-4 py-4 whitespace-nowrap">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-800">
          {filteredEnterprises.map((enterprise) => (
            <tr
              key={enterprise.id}
              tabIndex={0}
              role="button"
              onClick={() => onSelectEnterprise(enterprise)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectEnterprise(enterprise);
                }
              }}
              className="hover:bg-tgreen-dark/6 focus:bg-tgreen-dark/6 focus-visible:ring-tanaw-green/30 cursor-pointer transition outline-none focus-visible:ring-2"
            >
              <td className="px-4 py-4 whitespace-nowrap">
                <div className="flex w-full min-w-0 items-center gap-3 text-left">
                  <span className="bg-tgreen-dark/10 text-tgreen-dark flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                    <Building2 size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-gray-900">{enterprise.enterpriseName ?? enterprise.displayName}</span>
                    <span className="block truncate text-sm text-gray-500">{enterprise.category ?? "Uncategorized"}</span>
                  </span>
                </div>
              </td>
              <td className="truncate px-4 py-4 text-sm whitespace-nowrap text-gray-600">{enterprise.barangay ?? "N/A"}</td>
              <td className="px-4 py-4 whitespace-nowrap">
                <span title={enterprise.enterpriseId ?? "Pending"} className="block max-w-full truncate font-mono text-sm font-semibold text-gray-600">
                  {enterprise.enterpriseId ?? "Pending"}
                </span>
              </td>
              <td className="px-4 py-4 whitespace-nowrap">
                <StatusBadge tone={enterprise.status === "active" ? "green" : "slate"}>{enterprise.status}</StatusBadge>
              </td>
              <td className="px-4 py-4 text-sm whitespace-nowrap text-gray-500">
                <span title={enterprise.email} className="block max-w-full truncate">
                  {enterprise.email}
                </span>
                <span className="block text-xs text-gray-400">{new Date(enterprise.createdAt).toLocaleDateString()}</span>
              </td>
            </tr>
          ))}
          {filteredEnterprises.length === 0 && (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  icon={Building2}
                  title="No enterprise accounts"
                  description={isLoading ? "Loading accounts..." : accounts.length === 0 ? "Register an enterprise to generate development credentials." : "No enterprises match the current filters."}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
