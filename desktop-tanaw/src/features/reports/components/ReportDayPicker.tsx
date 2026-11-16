import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { formatReportDate, missingDays, type ReportDay, type ReportDayStatus } from "../model/daily-origins";
import { ReportPopover } from "./ReportPopover";

type Props = {
  days: ReportDay[];
  selectedDate: string;
  onSelect: (date: string) => void;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const STATUS_LABEL: Record<ReportDayStatus, string> = {
  complete: "visitor origins complete",
  missing: "visitor origins missing",
  "no-visitors": "no visitors recorded",
  upcoming: "not yet reached",
};

/** Calendar of the reporting month. Red badges mark days whose other visitor origins still need the user. */
export function ReportDayPicker({ days, selectedDate, onSelect }: Props) {
  const missing = missingDays(days).length;
  const first = days[0];
  if (!first) return null;
  const monthLabel = formatReportDate(first.date).replace(/\s\d+,/, "");
  return (
    <ReportPopover
      className="report-day-picker"
      panelClassName="report-day-popover"
      label="Choose a day"
      icon={null}
      width={340}
      trigger={
        <>
          <span className="report-day-picker-icon">
            <CalendarDays aria-hidden="true" />
            {missing > 0 && <span className="report-day-badge" aria-hidden="true" />}
          </span>
          <span className="sr-only">Selected day: </span>
          <span>{formatReportDate(selectedDate)}</span>
          {missing > 0 && <span className="sr-only">, {missing} days missing visitor origins</span>}
          <ChevronDown className="report-day-picker-chevron" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <div className="report-day-calendar">
          <header>
            <strong>{monthLabel}</strong>
            <span data-tone={missing ? "missing" : "complete"} role="status">
              {missing ? `${missing} ${missing === 1 ? "day needs" : "days need"} visitor origins` : "All days complete"}
            </span>
          </header>
          <div className="report-day-grid" role="group" aria-label={`Days of ${monthLabel}`}>
            {WEEKDAYS.map((weekday, index) => (
              <span key={index} className="report-day-weekday" aria-hidden="true">
                {weekday}
              </span>
            ))}
            {Array.from({ length: first.weekdayIndex }, (_, index) => (
              <span key={`blank-${index}`} aria-hidden="true" />
            ))}
            {days.map((day) => (
              <button
                key={day.date}
                type="button"
                data-status={day.status}
                aria-pressed={day.date === selectedDate}
                aria-label={`${formatReportDate(day.date)}, ${STATUS_LABEL[day.status]}`}
                disabled={day.status === "upcoming"}
                onClick={() => {
                  onSelect(day.date);
                  close();
                }}
              >
                {day.day}
                {day.status === "missing" && <span className="report-day-badge" aria-hidden="true" />}
                {day.status === "complete" && <Check className="report-day-check" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <ul className="report-day-legend" aria-label="Legend">
            <li data-status="missing">Needs visitor origins</li>
            <li data-status="complete">Complete</li>
            <li data-status="no-visitors">No visitors</li>
          </ul>
        </div>
      )}
    </ReportPopover>
  );
}
