export function shouldPrepareDraftPeriod(nextPeriod: string, currentReportingPeriod: string, pendingCounts: ReadonlyArray<{ period: string }>) {
  return !isSameReportingMonth(nextPeriod, currentReportingPeriod) && pendingCounts.some((counts) => isSameReportingMonth(counts.period, nextPeriod));
}

export function isSameReportingMonth(first: string, second: string) {
  return reportingMonthKey(first) === reportingMonthKey(second);
}

export function reportingMonthKey(value: string) {
  const normalizedValue = value.trim();
  const rangeMatch = /^([A-Za-z]+)\s+\d{1,2}\s*-\s*(?:([A-Za-z]+)\s+)?\d{1,2},\s*(\d{4})$/.exec(normalizedValue);
  if (rangeMatch) {
    return monthKey(rangeMatch[2] || rangeMatch[1], rangeMatch[3]) ?? normalizedValue.toLowerCase();
  }

  const monthYearMatch = /^([A-Za-z]+)\s+(\d{4})$/.exec(normalizedValue);
  if (monthYearMatch) {
    return monthKey(monthYearMatch[1], monthYearMatch[2]) ?? normalizedValue.toLowerCase();
  }

  return normalizedValue.toLowerCase();
}

function monthKey(monthLabel: string, yearLabel: string) {
  const monthIndex = MONTH_INDEX_BY_LABEL[monthLabel.slice(0, 3).toLowerCase()];
  const year = Number(yearLabel);
  if (typeof monthIndex !== "number" || !Number.isInteger(year)) return null;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

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
