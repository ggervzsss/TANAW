export function shouldPrepareDraftPeriod(nextPeriod: string, currentReportingPeriod: string, localMetricsPeriod: string, pendingCounts: ReadonlyArray<{ period: string }>) {
  return (
    !isSameReportingMonth(nextPeriod, currentReportingPeriod) &&
    !isSameReportingMonth(nextPeriod, localMetricsPeriod) &&
    pendingCounts.some((counts) => isSameReportingMonth(counts.period, nextPeriod))
  );
}

export function isSameReportingMonth(first: string, second: string) {
  return reportingMonthKey(first) === reportingMonthKey(second);
}

export function formatReportingPeriodRange(value: string) {
  const reportingMonth = parseReportingMonth(value);
  if (!reportingMonth) return value;

  const month = SHORT_MONTH_LABELS[reportingMonth.monthIndex];
  const lastDay = new Date(Date.UTC(reportingMonth.year, reportingMonth.monthIndex + 1, 0)).getUTCDate();
  return `${month} 1 - ${month} ${lastDay}, ${reportingMonth.year}`;
}

export function reportingMonthKey(value: string) {
  const normalizedValue = value.trim();
  const reportingMonth = parseReportingMonth(normalizedValue);
  if (!reportingMonth) return normalizedValue.toLowerCase();
  return `${reportingMonth.year}-${String(reportingMonth.monthIndex + 1).padStart(2, "0")}`;
}

function parseReportingMonth(value: string) {
  const normalizedValue = value.trim();
  const rangeMatch = /^([A-Za-z]+)\s+\d{1,2}\s*-\s*(?:([A-Za-z]+)\s+)?\d{1,2},\s*(\d{4})$/.exec(normalizedValue);
  if (rangeMatch) {
    return monthValue(rangeMatch[2] || rangeMatch[1], rangeMatch[3]);
  }

  const monthYearMatch = /^([A-Za-z]+)\s+(\d{4})$/.exec(normalizedValue);
  if (monthYearMatch) {
    return monthValue(monthYearMatch[1], monthYearMatch[2]);
  }

  return null;
}

function monthValue(monthLabel: string, yearLabel: string) {
  const monthIndex = MONTH_INDEX_BY_LABEL[monthLabel.slice(0, 3).toLowerCase()];
  const year = Number(yearLabel);
  if (typeof monthIndex !== "number" || !Number.isInteger(year)) return null;
  return { monthIndex, year };
}

const SHORT_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

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
