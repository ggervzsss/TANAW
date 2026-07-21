import { Search, UserPlus } from "lucide-react";
import { FilterSelect } from "@/shared/components/ui";
import type { LguRoleFilter, LguStatusFilter } from "../types";

type LguAccountsToolbarProps = {
  query: string;
  role: LguRoleFilter;
  status: LguStatusFilter;
  onQueryChange: (value: string) => void;
  onRoleChange: (value: LguRoleFilter) => void;
  onStatusChange: (value: LguStatusFilter) => void;
  onCreate: () => void;
};

export function LguAccountsToolbar({ query, role, status, onQueryChange, onRoleChange, onStatusChange, onCreate }: LguAccountsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
      <div className="relative min-w-0 flex-1 sm:min-w-70">
        <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search name or email"
          className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
        />
      </div>
      <FilterSelect
        value={role}
        onChange={(value) => onRoleChange(value as LguRoleFilter)}
        options={
          [
            ["all", "All Account Types"],
            ["admin", "Admin"],
            ["it", "IT Personnel"],
            ["staff", "LGU Staff"],
          ] as const
        }
      />
      <FilterSelect
        value={status}
        onChange={(value) => onStatusChange(value as LguStatusFilter)}
        options={
          [
            ["active", "Enabled"],
            ["inactive", "Disabled"],
          ] as const
        }
      />
      <button onClick={onCreate} className="bg-tgreen-dark hover:bg-tgreen-light inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition">
        <UserPlus size={16} /> Create LGU Account
      </button>
    </div>
  );
}
