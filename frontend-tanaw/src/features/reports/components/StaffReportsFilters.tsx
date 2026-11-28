import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { SearchField, Select, cn } from "@/shared/ui-kit";
import { usePhoneWidth } from "../hooks/usePhoneWidth";
import type { StaffReportFilters, StaffReportRow } from "../model/staffReports";
import { activeStaffReportFilterCount, staffReportFilterOptions, staffReportFiltersButtonLabel } from "../model/staffReports";

type StaffReportsFiltersProps = {
  rows: readonly StaffReportRow[];
  filters: StaffReportFilters;
  onChange: (patch: Partial<StaffReportFilters>) => void;
};

/**
 * Search plus submission, review and barangay filters for the Staff Reports list. On a phone the
 * search keeps the full width and the three selects fold under a Filters button that says how many
 * are set; from 640px up they sit in one row beside the search.
 */
export function StaffReportsFilters({ rows, filters, onChange }: StaffReportsFiltersProps) {
  const options = staffReportFilterOptions(rows);
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const setCount = activeStaffReportFilterCount(filters);
  // A shorter hint that fits beside the Filters button on a phone.
  const placeholder = usePhoneWidth() ? "Name, barangay or ID" : "Enterprise, barangay or report ID";
  return (
    <div role="search" aria-label="Filter reports" className="tanaw-staff-filters mt-2 grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] items-end gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
      <div className="flex min-w-0 items-end gap-2">
        <div className="min-w-0 flex-1">
          <span aria-hidden="true" className="mb-2 block text-[0.8125rem] font-semibold text-(--tanaw-text-secondary)">
            Search
          </span>
          <SearchField value={filters.query} onChange={(query) => onChange({ query })} placeholder={placeholder} label="Search reports" maxLength={120} />
        </div>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={staffReportFiltersButtonLabel(setCount)}
          data-set={setCount > 0 || undefined}
          onClick={() => setIsOpen((open) => !open)}
          className="tanaw-staff-filters-toggle"
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span className="tanaw-staff-filters-label">Filters</span>
          {setCount > 0 && (
            <span aria-hidden="true" className="tanaw-staff-filters-count">
              {setCount}
            </span>
          )}
        </button>
      </div>
      <div id={panelId} className={cn("contents max-sm:grid max-sm:gap-3", isOpen ? "tanaw-staff-filters-panel" : "max-sm:hidden")}>
        <Select label="Submission" value={filters.submission} options={options.submission} onChange={(value) => onChange({ submission: value as StaffReportFilters["submission"] })} />
        <Select label="Staff review" value={filters.review} options={options.review} onChange={(value) => onChange({ review: value as StaffReportFilters["review"] })} />
        <Select label="Barangay" value={filters.barangay} options={options.barangay} onChange={(barangay) => onChange({ barangay })} searchable />
      </div>
    </div>
  );
}
