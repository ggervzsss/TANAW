import { Building2 } from "lucide-react";
import { EmptyState, ExpandableTableText, StatusBadge } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/services/accountManagement";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";

type EnterpriseAccountsTableProps = {
  accounts: AccountSummary[];
  filteredEnterprises: AccountSummary[];
  isLoading: boolean;
  onSelectEnterprise: (enterprise: AccountSummary) => void;
};

export function EnterpriseAccountsTable({ accounts, filteredEnterprises, isLoading, onSelectEnterprise }: EnterpriseAccountsTableProps) {
  const { timeFormat } = useSystemDisplayPreferences();
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
              className="tanaw-interactive-row focus-visible:ring-tanaw-green/30 cursor-pointer outline-none focus-visible:ring-2"
            >
              <td className="px-4 py-4">
                <div className="flex w-full min-w-0 items-center gap-3 text-left">
                  <span className="bg-tgreen-dark/10 text-tgreen-dark flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                    <Building2 size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <ExpandableTableText
                      primary={enterprise.enterpriseName ?? enterprise.displayName}
                      secondary={enterprise.category ?? "Uncategorized"}
                      ariaLabel="enterprise name and category"
                      className="font-bold text-gray-900"
                      secondaryClassName="text-sm text-gray-500"
                    />
                  </div>
                </div>
              </td>
              <td className="truncate px-4 py-4 text-sm whitespace-nowrap text-gray-600">{enterprise.barangay ?? "N/A"}</td>
              <td className="px-4 py-4">
                <ExpandableTableText primary={enterprise.enterpriseId ?? "Pending"} ariaLabel="enterprise ID" className="font-mono text-sm font-semibold text-gray-600" />
              </td>
              <td className="px-4 py-4 whitespace-nowrap">
                <StatusBadge tone={enterprise.status === "inactive" ? "slate" : enterprise.isActivated ? "green" : "amber"}>
                  {enterprise.status === "inactive" ? "inactive" : enterprise.isActivated ? "active" : "pending activation"}
                </StatusBadge>
              </td>
              <td className="px-4 py-4 text-sm text-gray-500">
                <ExpandableTableText
                  primary={enterprise.email}
                  secondary={formatPhilippineDateTime(enterprise.createdAt, timeFormat, { dateStyle: "medium" })}
                  ariaLabel="enterprise contact and creation date"
                  secondaryClassName="text-xs text-gray-400"
                />
              </td>
            </tr>
          ))}
          {filteredEnterprises.length === 0 && (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  icon={Building2}
                  title="No enterprise accounts"
                  description={isLoading ? "Loading accounts..." : accounts.length === 0 ? "Register an enterprise to send its activation email." : "No enterprises match the current filters."}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
