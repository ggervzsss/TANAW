import { Users } from "lucide-react";
import { EmptyState, ExpandableTableText, StatusBadge } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { AccountSummary } from "@/shared/services/accountManagement";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { lguRoleLabel } from "../utils";

type LguAccountsTableProps = {
  accounts: AccountSummary[];
  filteredAccounts: AccountSummary[];
  isLoading: boolean;
  onSelectAccount: (account: AccountSummary) => void;
};

export function LguAccountsTable({ accounts, filteredAccounts, isLoading, onSelectAccount }: LguAccountsTableProps) {
  const { timeFormat } = useSystemDisplayPreferences();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-170 table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[23%]" />
          <col className="w-[25%]" />
          <col className="w-[18%]" />
          <col className="w-[16%]" />
          <col className="w-[18%]" />
        </colgroup>
        <thead className="bg-gray-50 text-[11px] font-bold tracking-wider text-gray-500 uppercase">
          <tr>
            {["Name", "Email", "Account Type", "Status", "Last Login"].map((heading) => (
              <th key={heading} className="px-4 py-4 whitespace-nowrap">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-800">
          {filteredAccounts.map((account) => (
            <tr
              key={account.id}
              tabIndex={0}
              role="button"
              onClick={() => onSelectAccount(account)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectAccount(account);
                }
              }}
              className="hover:bg-tgreen-dark/6 focus:bg-tgreen-dark/6 focus-visible:ring-tanaw-green/30 cursor-pointer transition outline-none focus-visible:ring-2"
            >
              <td className="px-4 py-4 text-gray-900">
                <ExpandableTableText primary={account.displayName} ariaLabel="account name" className="font-bold" threshold={34} />
              </td>
              <td className="px-4 py-4 text-sm text-gray-600">
                <ExpandableTableText primary={account.email} ariaLabel="account email" threshold={36} />
              </td>
              <td className="px-4 py-4 whitespace-nowrap">
                <StatusBadge tone="blue">{lguRoleLabel[account.role] ?? account.role}</StatusBadge>
              </td>
              <td className="px-4 py-4 whitespace-nowrap">
                <StatusBadge tone={account.status === "inactive" ? "slate" : account.isActivated ? "green" : "amber"}>{account.status === "inactive" ? "inactive" : account.isActivated ? "active" : "pending activation"}</StatusBadge>
              </td>
              <td className="truncate px-4 py-4 text-sm whitespace-nowrap text-gray-500">{account.lastLoginAt ? formatPhilippineDateTime(account.lastLoginAt, timeFormat) : "Never"}</td>
            </tr>
          ))}
          {filteredAccounts.length === 0 && (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  icon={Users}
                  title="No LGU accounts"
                  description={isLoading ? "Loading accounts..." : accounts.length === 0 ? "Create an LGU account to send its activation email." : "No accounts match the current filters."}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
