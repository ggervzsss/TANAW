import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardRange } from "../types/dashboard";
import { presetRange } from "../utils/dashboard-range";
import { DateRangePicker } from "./DateRangePicker";

type HeaderProps = {
  range: DashboardRange;
  today: string;
  onRangeChange: (range: DashboardRange) => void;
  /** A short notice beside the date control, such as the sample data note. */
  notice?: ReactNode;
};

export function DashboardHeader({ range, today, onRangeChange, notice }: HeaderProps) {
  const showingToday = range.from === today && range.to === today;
  return (
    <header className="dash-head">
      <div className="dash-head-title">
        <h1 className="dash-title">Dashboard</h1>
        <p className="dash-subtitle">Tourism Overview</p>
      </div>
      <div className="dash-head-actions">
        {notice}
        {!showingToday && (
          <button type="button" className="dash-button dash-button-ghost" onClick={() => onRangeChange(presetRange("today", today))}>
            <RotateCcw size={16} aria-hidden="true" />
            Back to today
          </button>
        )}
        <DateRangePicker range={range} today={today} onChange={onRangeChange} />
      </div>
    </header>
  );
}
