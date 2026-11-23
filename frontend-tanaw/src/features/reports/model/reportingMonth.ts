import type { IntakeReport } from "@/shared/types";
import { MONTH_NAMES, monthIndexOf } from "./reportStatuses";

/** One reporting month, such as October 2026. */
export type ReportingMonth = { month: (typeof MONTH_NAMES)[number]; year: number };

export function reportingMonth(index: number, year: number): ReportingMonth {
  return { month: MONTH_NAMES[index], year };
}

/** "October 2026" (the period text the backend stores) → October 2026. */
export function parseReportingPeriod(period: string | null | undefined): ReportingMonth | null {
  const match = /^\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(period ?? "");
  if (!match) return null;
  const index = monthIndexOf(match[1]);
  return index >= 0 ? reportingMonth(index, Number(match[2])) : null;
}

/** The URL form of a month: "2026-10". */
export function monthKey({ month, year }: ReportingMonth) {
  return `${year}-${String(monthIndexOf(month) + 1).padStart(2, "0")}`;
}

export function parseMonthKey(value: string | null | undefined): ReportingMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const index = Number(match[2]) - 1;
  return index >= 0 && index < 12 ? reportingMonth(index, Number(match[1])) : null;
}

/** "October 2026" */
export function formatReportingMonth({ month, year }: ReportingMonth) {
  return `${month} ${year}`;
}

/** Negative when `a` is earlier than `b`. */
export function compareMonths(a: ReportingMonth, b: ReportingMonth) {
  return a.year - b.year || monthIndexOf(a.month) - monthIndexOf(b.month);
}

export function sameMonth(a: ReportingMonth | null, b: ReportingMonth | null) {
  return Boolean(a && b && compareMonths(a, b) === 0);
}

function yearOf(value: string | null | undefined) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).getFullYear() : null;
}

/** The month an enterprise report covers: its month name, with the year from its period (or when it was sent). */
export function intakeReportMonth(report: Pick<IntakeReport, "month" | "period" | "submittedAt" | "submitted">): ReportingMonth | null {
  const index = monthIndexOf(report.month ?? "");
  if (index < 0) return parseReportingPeriod(report.period);
  const periodYear = report.period?.match(/\d{4}/)?.[0];
  const year = periodYear ? Number(periodYear) : (yearOf(report.submittedAt) ?? yearOf(report.submitted));
  return year === null ? null : reportingMonth(index, year);
}

/** The months that have reports, plus the current reporting month, newest first. */
export function reportingMonthOptions(reports: readonly IntakeReport[], current: ReportingMonth): ReportingMonth[] {
  const byKey = new Map<string, ReportingMonth>([[monthKey(current), current]]);
  for (const report of reports) {
    const month = intakeReportMonth(report);
    if (month) byKey.set(monthKey(month), month);
  }
  return [...byKey.values()].sort((a, b) => compareMonths(b, a));
}

/**
 * Parses a date from the API. A plain "2026-11-03" is read as that local calendar day, not UTC
 * midnight, so it never shows as the day before.
 */
export function parseApiDate(value: string | null | undefined) {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
