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

export function formatReportingPeriodLabel(value: string) {
  const reportingMonth = parseReportingMonth(value);
  if (!reportingMonth) return value;

  return `${MONTH_LABELS[reportingMonth.monthIndex]} ${reportingMonth.year}`;
}

export function reportingMonthKey(value: string) {
  const normalizedValue = value.trim();
  const reportingMonth = parseReportingMonth(normalizedValue);
  if (!reportingMonth) return normalizedValue.toLowerCase();
  return `${reportingMonth.year}-${String(reportingMonth.monthIndex + 1).padStart(2, "0")}`;
}

function parseReportingMonth(value: string) {
  const normalizedValue = value.trim();
  const monthYearMatch = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/.exec(normalizedValue);
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

const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

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
