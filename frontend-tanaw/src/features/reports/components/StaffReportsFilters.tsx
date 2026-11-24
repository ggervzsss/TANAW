import { SearchField, Select } from "@/shared/ui-kit";
import type { StaffReportFilters, StaffReportRow } from "../model/staffReports";
import { staffReportFilterOptions } from "../model/staffReports";

type StaffReportsFiltersProps = {
  rows: readonly StaffReportRow[];
  filters: StaffReportFilters;
  onChange: (patch: Partial<StaffReportFilters>) => void;
};

/** Search plus submission, review and barangay filters for the Staff Reports list. Each option shows how many enterprises it would list. */
export function StaffReportsFilters({ rows, filters, onChange }: StaffReportsFiltersProps) {
  const options = staffReportFilterOptions(rows, filters);
  return (
    <div role="search" aria-label="Filter reports" className="mt-2 grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] items-end gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
      <div className="min-w-0">
        <span aria-hidden="true" className="tracking-label mb-2 block text-xs font-bold text-(--tanaw-label) uppercase">
          Search
        </span>
        <SearchField value={filters.query} onChange={(query) => onChange({ query })} placeholder="Enterprise, barangay or report ID" label="Search reports" maxLength={120} />
      </div>
      <Select label="Submission" value={filters.submission} options={options.submission} onChange={(value) => onChange({ submission: value as StaffReportFilters["submission"] })} />
      <Select label="Staff review" value={filters.review} options={options.review} onChange={(value) => onChange({ review: value as StaffReportFilters["review"] })} />
      <Select label="Barangay" value={filters.barangay} options={options.barangay} onChange={(barangay) => onChange({ barangay })} searchable />
    </div>
  );
}
