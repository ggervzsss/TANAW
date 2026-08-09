import { Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { FilterSelect } from "@/shared/components/ui";
import { statusFilters, typeFilters, urgencyFilters, type StatusFilter, type TechnicalIssueFilters, type TypeFilter, type UrgencyFilter } from "../model";

export function TechnicalIssuesToolbar({ filters, setFilters }: { filters: TechnicalIssueFilters; setFilters: Dispatch<SetStateAction<TechnicalIssueFilters>> }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
      <div className="relative min-w-65 flex-1">
        <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
        <input
          value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          placeholder="Search issue, enterprise, person, or suggested action"
          className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
        />
      </div>
      <FilterSelect value={filters.urgency} onChange={(value) => setFilters((current) => ({ ...current, urgency: value as UrgencyFilter }))} options={urgencyFilters} />
      <FilterSelect value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value as StatusFilter }))} options={statusFilters} />
      <FilterSelect value={filters.type} onChange={(value) => setFilters((current) => ({ ...current, type: value as TypeFilter }))} options={typeFilters} />
    </div>
  );
}
