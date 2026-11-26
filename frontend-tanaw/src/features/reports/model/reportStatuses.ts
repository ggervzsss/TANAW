import type { RecordStatusTone } from "@/shared/ui-kit";
import type { IntakeReport } from "@/shared/types";

/*
 * The six report statuses the Admin and Staff portals show.
 *
 * Submission (has the enterprise sent its monthly report?):
 *   Submitted  a report exists for the month.
 *   Pending    no report yet, and the due date has not passed.
 *   Missing    no report, and the due date has passed.
 *
 * Staff review (where the month's report is in the staff workflow):
 *   Waiting       no report yet: staff are waiting on the enterprise (Submission is Pending or Missing).
 *   Reviewing     a report was sent and awaits the staff decision (stored "Pending Review"; a legacy
 *                 "Returned" report shows Reviewing too).
 *   Consolidated  "Ready to Consolidate" (accepted) or "Consolidated" (already in a monthly report).
 */

export type SubmissionStatus = "Submitted" | "Pending" | "Missing";
export type ReviewStatus = "Waiting" | "Reviewing" | "Consolidated";

/** Reports for a month are due on this day of the following month. The backend does not store a due date yet. */
export const REPORT_DUE_DAY = 10;

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const submissionTone: Record<SubmissionStatus, RecordStatusTone> = { Submitted: "submitted", Pending: "pending", Missing: "missing" };
export const reviewTone: Record<ReviewStatus, RecordStatusTone> = { Waiting: "waiting", Reviewing: "reviewing", Consolidated: "consolidated" };

export function monthIndexOf(month: string) {
  return MONTH_NAMES.findIndex((name) => name.toLowerCase() === month.trim().toLowerCase());
}

/** The due date of a reporting month: the 10th of the next month, at the end of that day. */
export function reportDueDate(month: string, year: number | string) {
  const index = monthIndexOf(month);
  return new Date(Number(year), index + 1, REPORT_DUE_DAY, 23, 59, 59, 999);
}

/** "Nov 10" */
export function formatShortDate(date: Date) {
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** "Nov 10, 2026" */
export function formatMediumDate(date: Date) {
  return `${formatShortDate(date)}, ${date.getFullYear()}`;
}

/** Whole days from the end of `from`'s day to `to`, never negative. */
function daysAfter(from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

export function reportSentAt(report: Pick<IntakeReport, "submittedAt" | "submitted">) {
  const value = report.submittedAt ?? report.submitted;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function submissionStatus(report: IntakeReport | undefined, month: string, year: number | string, today: Date): SubmissionStatus {
  if (report) return "Submitted";
  return today.getTime() > reportDueDate(month, year).getTime() ? "Missing" : "Pending";
}

export function reviewStatus(report: Pick<IntakeReport, "status"> | undefined): ReviewStatus {
  if (!report) return "Waiting";
  if (report.status === "Ready to Consolidate" || report.status === "Consolidated") return "Consolidated";
  return "Reviewing";
}

/**
 * The small note under a submission status: "12 days overdue" or "Due Dec 10". A report that was
 * sent gets no note; the sent date already shows when.
 */
export function submissionNote(report: IntakeReport | undefined, month: string, year: number | string, today: Date) {
  if (report) return null;
  const due = reportDueDate(month, year);
  if (today.getTime() <= due.getTime()) return `Due ${formatShortDate(due)}`;
  const overdue = daysAfter(due, today);
  return `${overdue} ${overdue === 1 ? "day" : "days"} overdue`;
}

/** The month whose reports are currently being collected: last month until its due date passes, then still last month. */
export function currentReportingMonth(today: Date) {
  const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return { month: MONTH_NAMES[previous.getMonth()], year: previous.getFullYear() };
}
