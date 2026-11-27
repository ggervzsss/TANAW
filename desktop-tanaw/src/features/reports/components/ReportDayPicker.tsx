import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { formatReportDate, missingDays, type ReportDay, type ReportDayStatus } from "../model/daily-origins";
import { formatReportingPeriodLabel, isSameReportingMonth } from "../utils/reporting-period";
import { ReportPopover } from "./ReportPopover";

type Props = {
  /** The reporting month on screen. */
  period: string;
  /** Every month the report can switch to, oldest first. */
  months: string[];
  days: ReportDay[];
  /** The day Visitor Details shows; null for a report submitted before daily entry. */
  selectedDate: string | null;
  isLoading?: boolean;
  onSelect?: (date: string) => void;
  onSelectMonth: (period: string) => void;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const STATUS_LABEL: Record<ReportDayStatus, string> = {
  complete: "visitor origins complete",
  missing: "visitor origins exceed the count",
  "no-visitors": "no visitors recorded",
  upcoming: "not yet reached",
};
/** "November 27, 2026" → "Nov 27, 2026"; every English month abbreviates to its first three letters. */
const abbreviateMonth = (label: string) => label.replace(/^([A-Z][a-z]{2})[a-z]+/, "$1");
/**
 * A two-digit day in every month, full and abbreviated. Hidden copies of these hold the trigger at
 * its widest label so it keeps one width, and the calendar under it stays put, as the month changes.
 */
const WIDEST_LABELS = Array.from({ length: 12 }, (_, month) => formatReportDate(`2000-${String(month + 1).padStart(2, "0")}-28`));
const WIDEST_SHORT_LABELS = WIDEST_LABELS.map(abbreviateMonth);

/** One version of the trigger label, stacked over hidden copies of the widest label of its kind. */
function PickerLabel({ length, text, widest }: { length: "full" | "short"; text: string; widest: string[] }) {
  return (
    <span className="report-day-picker-label" data-length={length} aria-hidden="true">
      <span>{text}</span>
      {widest.map((label) => (
        <span key={label} className="report-day-picker-sizer">
          {label}
        </span>
      ))}
    </span>
  );
}

/**
 * Calendar of the reporting month, with the months the report can switch to. Red badges mark days
 * whose entered origins add up to more than TANAW counted.
 */
export function ReportDayPicker({ period, months, days, selectedDate, isLoading = false, onSelect, onSelectMonth }: Props) {
  const daily = selectedDate !== null && days.length > 0;
  const missing = daily && !isLoading ? missingDays(days).length : 0;
  const monthLabel = formatReportingPeriodLabel(period);
  const triggerLabel = daily && selectedDate ? formatReportDate(selectedDate) : monthLabel;
  const index = months.findIndex((month) => isSameReportingMonth(month, period));
  const previous = index > 0 ? months[index - 1] : undefined;
  const next = index >= 0 && index < months.length - 1 ? months[index + 1] : undefined;
  const leading = days[0]?.weekdayIndex ?? 0;
  return (
    <ReportPopover
      className="report-day-picker"
      panelClassName="report-day-popover"
      label={daily ? "Choose a day" : "Choose a month"}
      icon={null}
      width={340}
      trigger={
        <>
          <span className="report-day-picker-icon">
            <CalendarDays aria-hidden="true" />
            {missing > 0 && <span className="report-day-badge" aria-hidden="true" />}
          </span>
          {/* Screen readers always hear the full date; the visible label shortens its month in a narrow column. */}
          <span className="sr-only">
            {daily ? "Selected day: " : "Selected month: "}
            {triggerLabel}
            {missing > 0 && `, ${missing} days with origins over the count`}
          </span>
          <PickerLabel length="full" text={triggerLabel} widest={WIDEST_LABELS} />
          <PickerLabel length="short" text={abbreviateMonth(triggerLabel)} widest={WIDEST_SHORT_LABELS} />
          <ChevronDown className="report-day-picker-chevron" aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <div className="report-day-calendar">
          <header>
            <div className="report-month-switch">
              <button
                type="button"
                aria-label={previous ? `Previous month, ${formatReportingPeriodLabel(previous)}` : "Previous month"}
                title={previous ? formatReportingPeriodLabel(previous) : "No earlier month"}
                disabled={!previous}
                onClick={() => previous && onSelectMonth(previous)}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <strong aria-live="polite">{monthLabel}</strong>
              <button
                type="button"
                aria-label={next ? `Next month, ${formatReportingPeriodLabel(next)}` : "Next month"}
                title={next ? formatReportingPeriodLabel(next) : "No later month"}
                disabled={!next}
                onClick={() => next && onSelectMonth(next)}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
            {isLoading ? (
              <span role="status">Loading days…</span>
            ) : daily ? (
              <span data-tone={missing ? "missing" : "complete"} role="status">
                {missing ? `${missing} ${missing === 1 ? "day needs" : "days need"} fixing` : "All days ready"}
              </span>
            ) : (
              <span role="status">Submitted with monthly totals</span>
            )}
          </header>
          {daily ? (
            <>
              <div className="report-day-grid" role="group" aria-label={`Days of ${monthLabel}`} aria-busy={isLoading}>
                {WEEKDAYS.map((weekday, weekdayIndex) => (
                  <span key={weekdayIndex} className="report-day-weekday" aria-hidden="true">
                    {weekday}
                  </span>
                ))}
                {Array.from({ length: leading }, (_, blank) => (
                  <span key={`blank-${blank}`} aria-hidden="true" />
                ))}
                {days.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    data-status={isLoading ? undefined : day.status}
                    aria-pressed={day.date === selectedDate}
                    aria-label={`${formatReportDate(day.date)}, ${STATUS_LABEL[day.status]}`}
                    disabled={isLoading || day.status === "upcoming"}
                    onClick={() => {
                      onSelect?.(day.date);
                      close();
                    }}
                  >
                    {day.day}
                    {!isLoading && day.status === "missing" && <span className="report-day-badge" aria-hidden="true" />}
                    {!isLoading && day.status === "complete" && <Check className="report-day-check" aria-hidden="true" />}
                  </button>
                ))}
              </div>
              <ul className="report-day-legend" aria-label="Legend">
                <li data-status="missing">Origins over the count</li>
                <li data-status="complete">Ready</li>
                <li data-status="no-visitors">No visitors</li>
              </ul>
            </>
          ) : (
            <p className="report-month-note">This report was submitted before daily entry, so it shows its monthly origins only.</p>
          )}
        </div>
      )}
    </ReportPopover>
  );
}
