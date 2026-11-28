export function getCurrentReportingPeriod() {
  const now = new Date();
  return reportingPeriodLabel(now);
}

function reportingPeriodLabel(value: Date) {
  const reportingValue = reportingDate(value);
  return `${monthName(reportingValue.monthIndex)} ${reportingValue.year}`;
}

export function getReportingPeriodSubmissionError(period: string, now = new Date()) {
  const periodEnd = reportingPeriodEndDate(period);
  if (!periodEnd) {
    return "Reporting period must use the Month YYYY format, for example June 2026.";
  }

  const opensOn = addCalendarDays(periodEnd, 1);
  if (calendarDateKey(reportingDate(now)) >= calendarDateKey(opensOn)) return null;

  return `Submission opens on ${formatCalendarDate(opensOn)} after the ${monthName(periodEnd.monthIndex)} ${periodEnd.year} reporting period closes.`;
}

/**
 * Reports for a month are due on this day of the following month: October's report is due
 * November 10. The LGU portal uses the same day.
 */
export const REPORT_DUE_DAY = 10;

/** The day a month's report is due, or null for a label that is not "Month YYYY". */
function reportingPeriodDueDate(period: string): CalendarDate | null {
  const periodEnd = reportingPeriodEndDate(period);
  if (!periodEnd) return null;
  return { ...addCalendarDays(periodEnd, 1), day: REPORT_DUE_DAY };
}

/** "Nov 10, 2026" for October 2026. */
export function formatReportingPeriodDueDate(period: string) {
  const due = reportingPeriodDueDate(period);
  return due ? formatCalendarDate(due) : null;
}

/** Whether the month's due date has passed: true from the day after it, in Philippine time. */
export function isReportingPeriodOverdue(period: string, now = new Date()) {
  const due = reportingPeriodDueDate(period);
  return due ? calendarDateKey(reportingDate(now)) > calendarDateKey(due) : false;
}

function reportingPeriodEndDate(value: string): CalendarDate | null {
  const normalizedValue = value.trim();
  const monthYearMatch = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/.exec(normalizedValue);
  if (monthYearMatch) {
    const monthIndex = monthIndexFromLabel(monthYearMatch[1]);
    const year = Number(monthYearMatch[2]);
    if (monthIndex === null || !Number.isInteger(year)) return null;
    return { day: lastDayOfMonth(year, monthIndex), monthIndex, year };
  }

  return null;
}

type CalendarDate = {
  day: number;
  monthIndex: number;
  year: number;
};

function monthIndexFromLabel(monthLabel: string): number | null {
  const monthIndex = MONTH_INDEX_BY_LABEL[monthLabel.slice(0, 3).toLowerCase()];
  return typeof monthIndex === "number" ? monthIndex : null;
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.monthIndex, value.day + days));
  return {
    day: date.getUTCDate(),
    monthIndex: date.getUTCMonth(),
    year: date.getUTCFullYear(),
  };
}

function reportingDate(value: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
  }).formatToParts(value);
  const partValue = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    day: partValue("day"),
    monthIndex: partValue("month") - 1,
    year: partValue("year"),
  };
}

function calendarDateKey(value: CalendarDate) {
  return value.year * 10_000 + (value.monthIndex + 1) * 100 + value.day;
}

function formatCalendarDate(value: CalendarDate) {
  return `${monthName(value.monthIndex, "short")} ${value.day}, ${value.year}`;
}

function monthName(monthIndex: number, format: "short" | "long" = "long") {
  return new Intl.DateTimeFormat("en-US", { month: format, timeZone: "UTC" }).format(new Date(Date.UTC(2026, monthIndex, 1)));
}

const REPORTING_TIME_ZONE = "Asia/Manila";

const MONTH_INDEX_BY_LABEL: Partial<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
