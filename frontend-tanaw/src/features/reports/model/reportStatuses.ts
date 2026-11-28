import type { RecordStatusTone } from "@/shared/ui-kit";
import type { IntakeReport } from "@/shared/types";

/*
 * The report statuses the Admin and Staff portals show, always for the month's latest report
 * version (see newerReport).
 *
 * Submission (has the enterprise sent its monthly report?):
 *   Submitted            a report exists for the month.
 *   Awaiting correction  staff returned the report; the corrected version has not arrived yet.
 *   Pending              no report yet, and the due date has not passed.
 *   Missing              no report, and the due date has passed.
 *
 * Staff review (where the month's report is in the staff workflow):
 *   Waiting       no report yet: staff are waiting on the enterprise (Submission is Pending or Missing).
 *   Reviewing     a report was sent and awaits the staff decision (stored "Pending Review").
 *   Returned      staff returned it to the enterprise for correction (stored "Returned").
 *   Consolidated  "Ready to Consolidate" (accepted) or "Consolidated" (already in a monthly report).
 *
 * A returned report is never accepted or consolidated: it counts as not sent until the enterprise
 * sends the corrected version, which arrives as a new report with the next version number.
 */

export type SubmissionStatus = "Submitted" | "Awaiting correction" | "Pending" | "Missing";
export type ReviewStatus = "Waiting" | "Reviewing" | "Returned" | "Consolidated";

/** Reports for a month are due on this day of the following month. The backend does not store a due date yet. */
export const REPORT_DUE_DAY = 10;

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const submissionTone: Record<SubmissionStatus, RecordStatusTone> = { Submitted: "submitted", "Awaiting correction": "pending", Pending: "pending", Missing: "missing" };
/** Returned shares the amber pending tint: the next step is the enterprise's. */
export const reviewTone: Record<ReviewStatus, RecordStatusTone> = { Waiting: "waiting", Reviewing: "reviewing", Returned: "pending", Consolidated: "consolidated" };

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

/** Whether staff returned this report for correction (and so it counts as not sent). */
export function isReturned(report: Pick<IntakeReport, "status"> | undefined): boolean {
  return report?.status === "Returned";
}

/** A report's version: 1 for the first report of a month, then one more for each corrected report. */
export function reportVersion(report: Pick<IntakeReport, "version">) {
  return report.version ?? 1;
}

/** The later of two reports for the same enterprise and month: the higher version, or else the one sent later. */
export function newerReport<T extends Pick<IntakeReport, "version" | "submittedAt" | "submitted">>(current: T | undefined, candidate: T): T {
  if (!current) return candidate;
  const byVersion = reportVersion(candidate) - reportVersion(current);
  if (byVersion !== 0) return byVersion > 0 ? candidate : current;
  return (reportSentAt(candidate)?.getTime() ?? 0) > (reportSentAt(current)?.getTime() ?? 0) ? candidate : current;
}

/** "Returned on Nov 12 by Maria Santos: <reason>", with whatever the report records. */
export function returnedNote(report: Pick<IntakeReport, "returnedAt" | "returnedBy" | "returnedReason">) {
  const at = report.returnedAt ? new Date(report.returnedAt) : null;
  const when = at && !Number.isNaN(at.getTime()) ? ` on ${formatShortDate(at)}` : "";
  const who = report.returnedBy?.trim() ? ` by ${report.returnedBy.trim()}` : "";
  const reason = report.returnedReason?.trim();
  return `Returned${when}${who}${reason ? `: ${reason}` : "."}`;
}

export function submissionStatus(report: IntakeReport | undefined, month: string, year: number | string, today: Date): SubmissionStatus {
  if (isReturned(report)) return "Awaiting correction";
  if (report) return "Submitted";
  return today.getTime() > reportDueDate(month, year).getTime() ? "Missing" : "Pending";
}

export function reviewStatus(report: Pick<IntakeReport, "status"> | undefined): ReviewStatus {
  if (!report) return "Waiting";
  if (report.status === "Returned") return "Returned";
  if (report.status === "Ready to Consolidate" || report.status === "Consolidated") return "Consolidated";
  return "Reviewing";
}

/**
 * The small note under a submission status: "12 days overdue", "Due Dec 10", or "Returned Nov 12"
 * for a report awaiting its correction. A report that was sent otherwise gets no note; the sent date
 * already shows when.
 */
export function submissionNote(report: IntakeReport | undefined, month: string, year: number | string, today: Date) {
  if (report && isReturned(report)) {
    const at = report.returnedAt ? new Date(report.returnedAt) : null;
    return at && !Number.isNaN(at.getTime()) ? `Returned ${formatShortDate(at)}` : "Returned";
  }
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
