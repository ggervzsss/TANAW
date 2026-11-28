import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import {
  formatShortDate,
  isReturned,
  MONTH_NAMES,
  newerReport,
  reportDueDate,
  reportSentAt,
  reviewStatus,
  submissionNote,
  submissionStatus,
  type ReviewStatus,
  type SubmissionStatus,
} from "./reportStatuses";
import { formatReportingMonth, intakeReportMonth, sameMonth, type ReportingMonth } from "./reportingMonth";

/*
 * The Staff Reports screen: one row per registered enterprise for the chosen month (its latest
 * report version), and what the staff member can do with it.
 *
 *   Review         the report awaits the staff decision (stored "Pending Review"): accept it, or
 *                  return it for correction.
 *   View           accepted, already in a monthly report, or returned for correction (read only).
 *   Remind         no report yet (Pending before the due date, Missing after it). A returned report
 *                  opens with View and can be reminded too, until its corrected version arrives.
 *
 * Rows run Missing, Awaiting correction, Pending, then Submitted; within each, Waiting, Returned,
 * Reviewing, then Consolidated; then by enterprise name.
 */

export type StaffReportAction = "review" | "view" | "remind";

export type StaffReportRow = {
  key: string;
  enterpriseId: string;
  name: string;
  barangay: string;
  report: IntakeReport | undefined;
  submission: SubmissionStatus;
  review: ReviewStatus;
  /** "Nov 9", or null when nothing was sent. */
  sent: string | null;
  /** "Due Nov 10", "12 days overdue" or "Returned Nov 12"; otherwise null once a report was sent. */
  note: string | null;
  action: StaffReportAction;
  /** Whether the row offers Remind: no report yet, or the report was returned for correction. */
  remind: boolean;
};

/** The month's latest report version when an enterprise has more than one (a returned report and its correction). */
function latestReport(reports: readonly IntakeReport[]) {
  return reports.reduce<IntakeReport | undefined>(newerReport, undefined);
}

function actionFor(report: IntakeReport | undefined): StaffReportAction {
  if (!report) return "remind";
  return report.status === "Pending Review" ? "review" : "view";
}

const SUBMISSION_ORDER: Record<SubmissionStatus, number> = { Missing: 0, "Awaiting correction": 1, Pending: 2, Submitted: 3 };
const REVIEW_ORDER: Record<ReviewStatus, number> = { Waiting: 0, Returned: 1, Reviewing: 2, Consolidated: 3 };

/** Missing, Awaiting correction, Pending, then Submitted; then Waiting, Returned, Reviewing, then Consolidated; then by name. */
export function compareStaffReportRows(a: StaffReportRow, b: StaffReportRow) {
  return SUBMISSION_ORDER[a.submission] - SUBMISSION_ORDER[b.submission] || REVIEW_ORDER[a.review] - REVIEW_ORDER[b.review] || a.name.localeCompare(b.name);
}

export function staffReportRows(enterprises: readonly ReportEnterprise[], reports: readonly IntakeReport[], month: ReportingMonth, today: Date): StaffReportRow[] {
  const forMonth = reports.filter((report) => sameMonth(intakeReportMonth(report), month));
  const byEnterprise = new Map<string, IntakeReport[]>();
  for (const report of forMonth) byEnterprise.set(report.enterpriseId, [...(byEnterprise.get(report.enterpriseId) ?? []), report]);

  // Registered enterprises, plus any enterprise that reported but is no longer in the list.
  const people = new Map(enterprises.map((enterprise) => [enterprise.id, { id: enterprise.id, name: enterprise.name, barangay: enterprise.barangay }]));
  for (const report of forMonth) if (!people.has(report.enterpriseId)) people.set(report.enterpriseId, { id: report.enterpriseId, name: report.enterprise, barangay: report.barangay });

  const rows = [...people.values()].map((enterprise): StaffReportRow => {
    const report = latestReport(byEnterprise.get(enterprise.id) ?? []);
    const sent = report ? reportSentAt(report) : null;
    return {
      key: enterprise.id,
      enterpriseId: enterprise.id,
      name: enterprise.name,
      barangay: enterprise.barangay,
      report,
      submission: submissionStatus(report, month.month, month.year, today),
      review: reviewStatus(report),
      sent: sent ? formatShortDate(sent) : null,
      note: submissionNote(report, month.month, month.year, today),
      action: actionFor(report),
      remind: !report || isReturned(report),
    };
  });
  return rows.sort(compareStaffReportRows);
}

// Filters ---------------------------------------------------------------------------------------

export type StaffReportFilters = {
  /** Enterprise name, barangay or report ID. */
  query: string;
  submission: "all" | SubmissionStatus;
  review: "all" | ReviewStatus;
  barangay: string;
};

export const EMPTY_STAFF_REPORT_FILTERS: StaffReportFilters = { query: "", submission: "all", review: "all", barangay: "all" };

const SUBMISSION_STATUSES: readonly SubmissionStatus[] = ["Submitted", "Awaiting correction", "Pending", "Missing"];
const REVIEW_STATUSES: readonly ReviewStatus[] = ["Waiting", "Reviewing", "Returned", "Consolidated"];

/** A status as the address writes it: "Awaiting correction" is `awaiting-correction`. */
function statusParam(status: string) {
  return status.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Filters from the address: `?q=&submission=awaiting-correction&review=waiting&barangay=Poblacion`. */
export function parseStaffReportFilters(params: URLSearchParams): StaffReportFilters {
  const pick = <T extends string>(values: readonly T[], value: string | null) => (value === null ? undefined : values.find((item) => statusParam(item) === statusParam(value))) ?? "all";
  return {
    query: (params.get("q") ?? "").slice(0, 120),
    submission: pick(SUBMISSION_STATUSES, params.get("submission")),
    review: pick(REVIEW_STATUSES, params.get("review")),
    barangay: params.get("barangay")?.trim() || "all",
  };
}

/** The address params for the filters; unset filters are left out. */
export function staffReportFilterParams(filters: StaffReportFilters): Record<string, string | null> {
  return {
    q: filters.query.trim() || null,
    submission: filters.submission === "all" ? null : statusParam(filters.submission),
    review: filters.review === "all" ? null : statusParam(filters.review),
    barangay: filters.barangay === "all" ? null : filters.barangay,
  };
}

export function hasStaffReportFilters(filters: StaffReportFilters) {
  return Boolean(filters.query.trim()) || filters.submission !== "all" || filters.review !== "all" || filters.barangay !== "all";
}

/** How many of the Submission, Staff review and Barangay filters are set (the search is counted apart). */
export function activeStaffReportFilterCount(filters: StaffReportFilters) {
  return [filters.submission, filters.review, filters.barangay].filter((value) => value !== "all").length;
}

/** The phone Filters button's name, saying how many filters are set. */
export function staffReportFiltersButtonLabel(count: number) {
  return count === 0 ? "Filters" : `Filters, ${count} set`;
}

export function rowMatchesFilters(row: StaffReportRow, filters: StaffReportFilters) {
  const query = filters.query.trim().toLowerCase();
  const matchesQuery = !query || [row.name, row.barangay, row.report?.code].some((value) => value?.toLowerCase().includes(query));
  return (
    matchesQuery &&
    (filters.submission === "all" || row.submission === filters.submission) &&
    (filters.review === "all" || row.review === filters.review) &&
    (filters.barangay === "all" || row.barangay === filters.barangay)
  );
}

export function filterStaffReportRows(rows: readonly StaffReportRow[], filters: StaffReportFilters) {
  return rows.filter((row) => rowMatchesFilters(row, filters));
}

/** Dropdown options for the submission, review and barangay filters, as plain labels without counts. */
export function staffReportFilterOptions(rows: readonly StaffReportRow[]) {
  const option = (value: string, label = value) => ({ value, label });
  const barangays = [...new Set(rows.map((row) => row.barangay).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    submission: [option("all", "All submissions"), ...SUBMISSION_STATUSES.map((status) => option(status))],
    review: [option("all", "All reviews"), ...REVIEW_STATUSES.map((status) => option(status))],
    barangay: [option("all", "All barangays"), ...barangays.map((name) => option(name))],
  };
}

// Reminders -------------------------------------------------------------------------------------

/** The Remind button: its text and accessible name, before and after the reminder goes out. */
export function reminderButton(name: string, reminded: boolean) {
  return reminded ? { label: "Reminded", ariaLabel: `Reminded ${name}` } : { label: "Remind", ariaLabel: `Remind ${name}` };
}

/** "Reminder sent to Daisy Resort for October 2026." */
export function reminderSentMessage(name: string, monthLabel: string) {
  return `Reminder sent to ${name} for ${monthLabel}.`;
}

/** "The reminder to Daisy Resort for October 2026 could not be sent. Try again." */
export function reminderFailedMessage(name: string, monthLabel: string) {
  return `The reminder to ${name} for ${monthLabel} could not be sent. Try again.`;
}

export type StaffReminder = { title: string; message: string; severity: "Info" | "Warning" };

/**
 * The notice a reminder sends to the desktop app: send the month's report (before or after its due
 * date), or send the corrected version of a returned report, repeating why it was returned.
 */
export function staffReminder(row: Pick<StaffReportRow, "submission" | "report">, monthLabel: string, due: string): StaffReminder {
  if (row.submission === "Awaiting correction") {
    const reason = row.report?.returnedReason?.trim();
    return {
      title: "Corrected report reminder",
      message: `Please send the corrected ${monthLabel} report. ${reason ? `It was returned for correction: ${reason}` : "It was returned for correction."}`,
      severity: "Warning",
    };
  }
  if (row.submission === "Missing") return { title: "Monthly report reminder", message: `Please send your ${monthLabel} monthly report. It was due ${due}.`, severity: "Warning" };
  return { title: "Monthly report reminder", message: `Please send your ${monthLabel} monthly report by ${due}.`, severity: "Info" };
}

// Progress and generation -------------------------------------------------------------------------

export type StaffReportsProgress = {
  /** Reports sent and not returned: waiting for staff, accepted or consolidated. */
  received: number;
  consolidated: number;
  /** Received reports awaiting the staff decision. */
  reviewing: number;
  /** Enterprises that have not sent a report yet. */
  waiting: number;
  /** Accepted reports not yet in a monthly report: what Generate would include. */
  readyReportIds: string[];
  /** Enterprises that have not sent a report yet. */
  notSent: StaffReportRow[];
  /** Enterprises whose report was returned and whose corrected version has not arrived yet. */
  awaitingCorrection: StaffReportRow[];
  /** Every received report is accepted and at least one is not in a monthly report yet. */
  canGenerate: boolean;
  /** Every received report is already in a monthly report. */
  generated: boolean;
};

/**
 * Enterprises that have not sent a report, or whose report awaits its correction, do not block
 * generation; the backend builds the monthly report from the accepted reports it is given.
 */
export function staffReportsProgress(rows: readonly StaffReportRow[]): StaffReportsProgress {
  const received = rows.filter((row) => row.report && !isReturned(row.report));
  const count = (status: ReviewStatus) => rows.filter((row) => row.review === status).length;
  const consolidated = count("Consolidated");
  const readyReportIds = received.flatMap((row) => (row.report?.status === "Ready to Consolidate" ? [row.report.id] : []));
  const allAccepted = received.length > 0 && consolidated === received.length;
  return {
    received: received.length,
    consolidated,
    reviewing: count("Reviewing"),
    waiting: count("Waiting"),
    readyReportIds,
    notSent: rows.filter((row) => !row.report),
    awaitingCorrection: rows.filter((row) => isReturned(row.report)),
    canGenerate: allAccepted && readyReportIds.length > 0,
    generated: allAccepted && readyReportIds.length === 0,
  };
}

/**
 * The page caption: "Reports for October 2026, due November 10. Accept each submitted report, then
 * generate the consolidated report." The due year is named only when it differs from the month's.
 */
export function staffReportsCaption(month: ReportingMonth) {
  const due = reportDueDate(month.month, month.year);
  const dueYear = due.getFullYear() === month.year ? "" : `, ${due.getFullYear()}`;
  return `Reports for ${formatReportingMonth(month)}, due ${MONTH_NAMES[due.getMonth()]} ${due.getDate()}${dueYear}. Accept each submitted report, then generate the consolidated report.`;
}

/** "1 returned report is", "2 returned reports are" */
function returnedReports(count: number) {
  return count === 1 ? "1 returned report is" : `${count} returned reports are`;
}

/** One line beside the filters saying whether the month can be generated yet, and what awaits correction. */
export function staffReportsSummary(progress: StaffReportsProgress, month: ReportingMonth) {
  const returned = progress.awaitingCorrection.length;
  return `${progressSummary(progress, month)}${returned ? ` ${returnedReports(returned)} awaiting correction.` : ""}`;
}

function progressSummary(progress: StaffReportsProgress, month: ReportingMonth) {
  const { received, consolidated } = progress;
  if (received === 0) return `No ${formatReportingMonth(month)} reports received yet.`;
  if (progress.generated) return "The consolidated report for this month has been generated.";
  if (progress.canGenerate) return received === 1 ? "The received report is consolidated. Ready to generate." : `All ${received} received reports are consolidated. Ready to generate.`;
  return `${consolidated} of ${received} received ${received === 1 ? "report" : "reports"} consolidated. Generate once ${received === 1 ? "it is" : `all ${received} are`}.`;
}

/**
 * The Generate confirmation: "Combine the 3 accepted reports into the October 2026 monthly report
 * (VAR 2M). 1 enterprise has not sent a report and will not be included." A returned report that
 * awaits its correction is left out the same way.
 */
export function generateConfirmMessage(monthLabel: string, progress: Pick<StaffReportsProgress, "readyReportIds" | "notSent" | "awaitingCorrection">) {
  const accepted = progress.readyReportIds.length;
  const notSent = progress.notSent.length;
  const returned = progress.awaitingCorrection.length;
  const missing = notSent ? ` ${notSent} ${notSent === 1 ? "enterprise has" : "enterprises have"} not sent a report and will not be included.` : "";
  const correcting = returned ? ` ${returnedReports(returned)} awaiting correction and will not be included.` : "";
  return `Combine the ${accepted} accepted ${accepted === 1 ? "report" : "reports"} into the ${monthLabel} monthly report (VAR 2M).${missing}${correcting}`;
}
