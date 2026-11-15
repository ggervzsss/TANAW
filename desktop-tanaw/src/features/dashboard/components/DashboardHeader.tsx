import { CalendarDays } from "lucide-react";
import type { TrendFilter } from "../types/dashboard";
import { SelectDropdown } from "../../../components/SelectDropdown";

export function DashboardHeader({ filter, onFilterChange, sampleDate }: { sampleDate?: string; filter: TrendFilter; onFilterChange: (filter: TrendFilter) => void }) {
  const date = new Date(sampleDate ?? Date.now()).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" });
  return (
    <header className="overview-header">
      <div>
        <h1>Dashboard</h1>
        <p>Tourism Overview{sampleDate && " \u00b7 Mock data"}</p>
      </div>
      <div className="overview-date">
        <CalendarDays aria-hidden="true" />
        <SelectDropdown
          className="overview-date-dropdown"
          restoreFocusOnTab
          menuClassName="dashboard-date-menu"
          ariaLabel="Dashboard date range"
          value={filter}
          onChange={(value) => onFilterChange(value as TrendFilter)}
          options={[
            ["Today", `Today, ${date}`],
            ["Week", "Past 7 days"],
            ["Month", "Past 30 days"],
          ]}
        />
      </div>
    </header>
  );
}
