import { FileSignature, Search } from "lucide-react";

type BatchReportsToolbarProps = {
  query: string;
  barangayFilter: string;
  monthFilter: string;
  yearFilter: string;
  availableBarangays: string[];
  availableMonths: string[];
  availableYears: string[];
  allReady: boolean;
  onQueryChange: (value: string) => void;
  onBarangayChange: (value: string) => void;
  onMonthChange: (value: string) => void;
  onYearChange: (value: string) => void;
  onGenerate: () => void;
};

export function BatchReportsToolbar({
  query,
  barangayFilter,
  monthFilter,
  yearFilter,
  availableBarangays,
  availableMonths,
  availableYears,
  allReady,
  onQueryChange,
  onBarangayChange,
  onMonthChange,
  onYearChange,
  onGenerate,
}: BatchReportsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
      <div className="relative min-w-65 flex-1">
        <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search enterprise, barangay, category, or report ID"
          className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
        />
      </div>
      <select value={barangayFilter} onChange={(event) => onBarangayChange(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none">
        <option value="all">All Barangays</option>
        {availableBarangays.map((barangay) => (
          <option key={barangay} value={barangay}>
            {barangay}
          </option>
        ))}
      </select>
      <select value={monthFilter} onChange={(event) => onMonthChange(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none">
        {availableMonths.map((month) => (
          <option key={month} value={month}>
            {month}
          </option>
        ))}
      </select>
      <select value={yearFilter} onChange={(event) => onYearChange(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none">
        {availableYears.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      <button
        onClick={onGenerate}
        disabled={!allReady}
        title={!allReady ? "All enterprises must be Ready to Consolidate before generating." : "Generate Final Report"}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${
          allReady ? "bg-tgreen-dark hover:bg-tgreen-light cursor-pointer text-white" : "cursor-not-allowed bg-gray-200 text-gray-400"
        }`}
      >
        <FileSignature size={15} /> Generate Final Report
      </button>
    </div>
  );
}
