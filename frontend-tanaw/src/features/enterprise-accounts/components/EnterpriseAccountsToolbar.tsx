import { Building2, Search } from "lucide-react";
import { FilterSelect } from "@/shared/components/ui";
import type { EnterpriseStatusFilter } from "../types";

type EnterpriseAccountsToolbarProps = {
  query: string;
  status: EnterpriseStatusFilter;
  barangay: string;
  barangays: string[];
  onQueryChange: (value: string) => void;
  onStatusChange: (value: EnterpriseStatusFilter) => void;
  onBarangayChange: (value: string) => void;
  onRegister: () => void;
};

export function EnterpriseAccountsToolbar({ query, status, barangay, barangays, onQueryChange, onStatusChange, onBarangayChange, onRegister }: EnterpriseAccountsToolbarProps) {
  return (
    <div className="grid grid-cols-1 gap-3 border-b border-gray-200 bg-gray-50 p-4 xl:grid-cols-[minmax(260px,1fr)_auto_auto_auto]">
      <div className="relative">
        <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search enterprise, manager, category, or barangay"
          className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
        />
      </div>
      <FilterSelect value={barangay} onChange={onBarangayChange} options={barangays.map((item): [string, string] => [item, item])} />
      <FilterSelect
        value={status}
        onChange={(value) => onStatusChange(value as EnterpriseStatusFilter)}
        options={
          [
            ["all", "All Statuses"],
            ["active", "Active"],
            ["inactive", "Inactive"],
          ] as const
        }
      />
      <button
        onClick={onRegister}
        className="bg-tgreen-dark hover:bg-tgreen-light inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition"
      >
        <Building2 size={16} /> Register Enterprise
      </button>
    </div>
  );
}
