import { FilterSelect } from "@/shared/components/ui";
import { SearchField } from "@/shared/ui-kit";
import { ticketGroupFilters, ticketStatusFilters, type TicketFilterState, type TicketGroupFilter, type TicketStatusFilter } from "../model";

/** Search plus status and group filters, open on the page above the requests. */
export function SupportTicketFilters({ filters, onChange }: { filters: TicketFilterState; onChange: (update: (current: TicketFilterState) => TicketFilterState) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-65 flex-1">
        <SearchField
          value={filters.query}
          onChange={(query) => onChange((current) => ({ ...current, query }))}
          placeholder="Search reference, place, person, request or group"
        />
      </div>
      <FilterSelect value={filters.status} onChange={(value) => onChange((current) => ({ ...current, status: value as TicketStatusFilter }))} options={ticketStatusFilters} />
      <FilterSelect value={filters.group} onChange={(value) => onChange((current) => ({ ...current, group: value as TicketGroupFilter }))} options={ticketGroupFilters} />
    </div>
  );
}
