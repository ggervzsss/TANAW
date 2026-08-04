import { Search } from "lucide-react";
import { FilterSelect } from "@/shared/components/ui";
import { activityTimeRanges, type ActivityTimeRange } from "@/shared/utils";
import { activityGroups, type ActivityGroup } from "../model";

export function ITSystemLogFilters(props: {
  accountFilter: string;
  accountOptions: string[];
  query: string;
  showRoutine: boolean;
  timeRange: ActivityTimeRange;
  typeFilter: string;
  typeOptions: string[];
  onAccountChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onRoutineChange: (value: boolean) => void;
  onTimeRangeChange: (value: ActivityTimeRange) => void;
  onTypeChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={props.query} placeholder="Search summary or name" onChange={props.onQueryChange} />
        <FilterSelect value={props.typeFilter} onChange={props.onTypeChange} options={props.typeOptions} />
        <FilterSelect value={props.accountFilter} onChange={props.onAccountChange} options={props.accountOptions} />
        <FilterSelect value={props.timeRange} onChange={(value) => props.onTimeRangeChange(value as ActivityTimeRange)} options={activityTimeRanges} />
        <button
          type="button"
          onClick={() => props.onRoutineChange(!props.showRoutine)}
          className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${props.showRoutine ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-gray-300 bg-white text-gray-600 hover:border-emerald-300"}`}
        >
          {props.showRoutine ? "Hide routine activity" : "Show routine activity"}
        </button>
      </div>
    </div>
  );
}

export function AdminActivityFilters(props: {
  activityGroup: ActivityGroup;
  query: string;
  timeRange: ActivityTimeRange;
  onActivityGroupChange: (value: ActivityGroup) => void;
  onQueryChange: (value: string) => void;
  onTimeRangeChange: (value: ActivityTimeRange) => void;
}) {
  return (
    <div className="tanaw-data-toolbar flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
      <SearchInput value={props.query} placeholder="Search activity, name, affected item, or details" onChange={props.onQueryChange} className="min-w-65" />
      <FilterSelect value={props.activityGroup} onChange={(value) => props.onActivityGroupChange(value as ActivityGroup)} options={activityGroups} />
      <FilterSelect value={props.timeRange} onChange={(value) => props.onTimeRangeChange(value as ActivityTimeRange)} options={activityTimeRanges} />
    </div>
  );
}

function SearchInput({ value, placeholder, onChange, className = "sm:min-w-64" }: { value: string; placeholder: string; onChange: (value: string) => void; className?: string }) {
  return (
    <div className={`relative min-w-0 flex-1 ${className}`}>
      <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="tanaw-data-search focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
      />
    </div>
  );
}
