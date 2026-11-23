import { MONTH_NAMES, monthIndexOf, reportSentAt } from "@/features/reports/model/reportStatuses";
import type { IntakeReport } from "@/shared/types";

/** One reporting month: a calendar month of a year, `monthIndex` 0 for January. */
export type MonthKey = { year: number; monthIndex: number };

export function monthKeyId(month: MonthKey) {
  return `${month.year}-${String(month.monthIndex + 1).padStart(2, "0")}`;
}

/** The month a `monthKeyId` ("2026-10") names; null when it is not one. */
export function monthFromKeyId(id: string | null | undefined): MonthKey | null {
  const match = id?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const monthIndex = Number(match[2]) - 1;
  return monthIndex >= 0 && monthIndex < 12 ? { year: Number(match[1]), monthIndex } : null;
}

/** Months since year 0, so two months compare with < and >. */
export function monthOrdinal(month: MonthKey) {
  return month.year * 12 + month.monthIndex;
}

export function monthOfDate(date: Date): MonthKey {
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}

export function addMonths(month: MonthKey, step: number): MonthKey {
  const date = new Date(month.year, month.monthIndex + step, 1);
  return monthOfDate(date);
}

export function sameMonth(left: MonthKey | null | undefined, right: MonthKey | null | undefined) {
  return Boolean(left && right && left.year === right.year && left.monthIndex === right.monthIndex);
}

export function minMonth(left: MonthKey | null, right: MonthKey | null) {
  if (!left) return right;
  if (!right) return left;
  return monthOrdinal(left) <= monthOrdinal(right) ? left : right;
}

/** "October" */
export function monthName(month: MonthKey) {
  return MONTH_NAMES[month.monthIndex];
}

/** "October 2026" */
export function periodLabel(month: MonthKey) {
  return `${monthName(month)} ${month.year}`;
}

/** Reads a month name ("October") and a year ("2026") from a link; null when either is not valid. */
export function parseMonthParams(month: string | null | undefined, year: string | null | undefined): MonthKey | null {
  if (!month || !year || !/^\d{4}$/.test(year.trim())) return null;
  const monthIndex = monthIndexOf(month);
  return monthIndex === -1 ? null : { year: Number(year.trim()), monthIndex };
}

/** The reporting month an intake report covers, from its month name and the year in its period. */
export function reportMonthOf(report: Pick<IntakeReport, "month" | "period" | "submittedAt" | "submitted">): MonthKey | null {
  const monthIndex = monthIndexOf(report.month);
  if (monthIndex === -1) return null;
  const periodYear = report.period.match(/\d{4}/)?.[0];
  if (periodYear) return { year: Number(periodYear), monthIndex };
  const sent = reportSentAt(report);
  return sent ? { year: sent.getFullYear(), monthIndex } : null;
}

/** A calendar date from "2026-11-21" (or the date part of a timestamp), read in local time. */
export function parseCalendarDate(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
