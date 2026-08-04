import { Search } from "lucide-react";
import { FilterSelect } from "@/shared/components/ui";
import { ticketCategoryFilters, ticketPriorityFilters, ticketStatusFilters, type TicketCategoryFilter, type TicketFilterState, type TicketPriorityFilter, type TicketStatusFilter } from "../model";

export function SupportTicketFilters({ filters, onChange }: { filters: TicketFilterState; onChange: (update: (current: TicketFilterState) => TicketFilterState) => void }) {
  return (
    <div className="tanaw-data-toolbar flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
      <div className="relative min-w-65 flex-1">
        <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
        <input
          value={filters.query}
          onChange={(event) => onChange((current) => ({ ...current, query: event.target.value }))}
          placeholder="Search ticket ID, enterprise, subject, category, or status"
          className="tanaw-data-search focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
        />
      </div>
      <FilterSelect value={filters.status} onChange={(value) => onChange((current) => ({ ...current, status: value as TicketStatusFilter }))} options={ticketStatusFilters} />
      <FilterSelect value={filters.priority} onChange={(value) => onChange((current) => ({ ...current, priority: value as TicketPriorityFilter }))} options={ticketPriorityFilters} />
      <FilterSelect value={filters.category} onChange={(value) => onChange((current) => ({ ...current, category: value as TicketCategoryFilter }))} options={ticketCategoryFilters} />
    </div>
  );
}
