import { Users } from "lucide-react";
import { EmptyState, StatusBadge } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/services/accountManagement";
import { lguRoleLabel } from "../utils";

type LguAccountsTableProps = {
  accounts: AccountSummary[];
  filteredAccounts: AccountSummary[];
  isLoading: boolean;
  onSelectAccount: (account: AccountSummary) => void;
};

export function LguAccountsTable({ accounts, filteredAccounts, isLoading, onSelectAccount }: LguAccountsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-170 table-fixed text-left text-sm">
        <thead className="bg-gray-50 text-[11px] font-bold tracking-wider text-gray-500 uppercase">
          <tr>
            {["Name", "Email", "Role", "Status", "Last Login"].map((heading) => (
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
              <td className="px-4 py-4 font-bold whitespace-nowrap text-gray-900">{account.displayName}</td>
              <td className="truncate px-4 py-4 text-sm whitespace-nowrap text-gray-600">{account.email}</td>
              <td className="px-4 py-4 whitespace-nowrap">
                <StatusBadge tone="blue">{lguRoleLabel[account.role] ?? account.role}</StatusBadge>
              </td>
              <td className="px-4 py-4 whitespace-nowrap">
                <StatusBadge tone={account.status === "active" ? "green" : "slate"}>{account.status}</StatusBadge>
              </td>
              <td className="truncate px-4 py-4 text-sm whitespace-nowrap text-gray-500">{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : "Never"}</td>
            </tr>
          ))}
          {filteredAccounts.length === 0 && (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  icon={Users}
                  title="No LGU accounts"
                  description={isLoading ? "Loading accounts..." : accounts.length === 0 ? "Create an LGU account to generate development credentials." : "No accounts match the current filters."}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
