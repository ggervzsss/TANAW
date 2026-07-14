import type { CanonicalReportingPeriod } from "../../../types/enterprise";

export const REPORTING_TIME_ZONE = "Asia/Manila";
export const UNCLASSIFIED_REPORTING_PERIOD_LABEL = "Reporting period unavailable";

const NATURAL_KEY_PATTERN = /^month:Asia\/Manila:(\d{4})-(0[1-9]|1[0-2])$/;

type CanonicalReportingPeriodSource = {
  period_id?: unknown;
  period?: unknown;
  starts_at_utc?: unknown;
  ends_at_utc?: unknown;
};

export function canonicalReportingPeriodFromSource(source: CanonicalReportingPeriodSource): CanonicalReportingPeriod {
  if (typeof source.period_id !== "string" || !source.period_id.trim()) {
    throw new Error("No canonical reporting period is available. Capture or select a classified period before submitting.");
  }
  const periodId = source.period_id.trim();
  const naturalKey = NATURAL_KEY_PATTERN.exec(periodId);
  if (!naturalKey || Number(naturalKey[1]) < 1) {
    throw new Error("The reporting period identity is invalid. Expected month:Asia/Manila:YYYY-MM.");
  }
  if (typeof source.starts_at_utc !== "string" || typeof source.ends_at_utc !== "string") {
    throw new Error("The canonical reporting period is missing its exact UTC source window. Refresh the local ledger before submitting.");
  }

  const startsAtUtc = canonicalUtcInstant(source.starts_at_utc, "start");
  const endsAtUtc = canonicalUtcInstant(source.ends_at_utc, "end");
  if (Date.parse(startsAtUtc) >= Date.parse(endsAtUtc)) {
    throw new Error("The canonical reporting period UTC source window is invalid.");
  }

  const year = Number(naturalKey[1]);
  const month = Number(naturalKey[2]);
  assertManilaBoundary(startsAtUtc, { year, month }, "start");
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  assertManilaBoundary(endsAtUtc, nextMonth, "end");

  return {
    periodId,
    label: typeof source.period === "string" && source.period.trim() ? source.period.trim() : periodId,
    startsAtUtc,
    endsAtUtc,
  };
}

export function getReportingPeriodSubmissionError(period: CanonicalReportingPeriod | null, now = new Date()): string | null {
  if (!period) {
    return "No canonical reporting period is selected. Refresh local metrics or select a classified period before submitting.";
  }
  if (!Number.isFinite(now.getTime())) return "The current time is invalid. Correct the system clock before submitting.";
  if (now.getTime() >= Date.parse(period.endsAtUtc)) return null;
  return `Submission opens after ${formatManilaDate(period.endsAtUtc)}, when ${period.label} closes.`;
}

export function requireCanonicalReportingPeriod(period: CanonicalReportingPeriod | null | undefined): CanonicalReportingPeriod {
  if (!period) {
    throw new Error("This report has no canonical reporting period. Refresh its target ledger record before viewing, previewing, or exporting it.");
  }
  return period;
}

export function reportingPeriodContains(period: CanonicalReportingPeriod, instant: string | Date) {
  const timestamp = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  return Number.isFinite(timestamp) && Date.parse(period.startsAtUtc) <= timestamp && timestamp < Date.parse(period.endsAtUtc);
}

function canonicalUtcInstant(value: string, boundary: "start" | "end") {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    throw new Error(`The reporting period ${boundary} must be an offset-aware ISO-8601 UTC instant.`);
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new Error(`The reporting period ${boundary} instant is invalid.`);
  return new Date(timestamp).toISOString();
}

function assertManilaBoundary(value: string, expected: { year: number; month: number }, boundary: "start" | "end") {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  if (part("year") !== expected.year || part("month") !== expected.month || part("day") !== 1 || part("hour") !== 0 || part("minute") !== 0 || part("second") !== 0) {
    throw new Error(`The reporting period ${boundary} does not match the exact ${REPORTING_TIME_ZONE} calendar boundary for its natural key.`);
  }
}

function formatManilaDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
  }).format(new Date(value));
}
