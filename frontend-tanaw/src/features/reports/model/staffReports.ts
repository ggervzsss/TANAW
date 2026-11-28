import type { FinalReport, IntakeReport, ReportEnterprise } from "@/shared/types";
import {
  formatShortDate,
  MONTH_NAMES,
  reportDueDate,
  reportSentAt,
  reviewStatus,
  submissionNote,
  submissionStatus,
  type ReviewStatus,
  type SubmissionStatus,
} from "./reportStatuses";
import { formatReportingMonth, intakeReportMonth, parseApiDate, parseReportingPeriod, sameMonth, type ReportingMonth } from "./reportingMonth";

/*
 * The Staff Reports screen: one row per registered enterprise for the chosen month, and what the
 * staff member can do with it.
 *
 *   Review         the report awaits the staff decision (stored "Pending Review"): accept it.
 *   View           accepted, or already in a monthly report (read only).
 *   Remind         no report yet (Pending before the due date, Missing after it).
 *
 * Rows run Missing, Pending, then Submitted; within each, Waiting, Reviewing, then Consolidated;
 * then by enterprise name.
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
  /** "Due Nov 10" or "12 days overdue"; null once a report was sent. */
  note: string | null;
  action: StaffReportAction;
  /** Whether the row offers Remind: the enterprise has not sent its report yet. */
  remind: boolean;
};

function actionFor(report: IntakeReport | undefined): StaffReportAction {
  if (!report) return "remind";
  return report.status === "Pending Review" ? "review" : "view";
}

const SUBMISSION_ORDER: Record<SubmissionStatus, number> = { Missing: 0, Pending: 1, Submitted: 2 };
const REVIEW_ORDER: Record<ReviewStatus, number> = { Waiting: 0, Reviewing: 1, Consolidated: 2 };

/** Missing, Pending, then Submitted; then Waiting, Reviewing, then Consolidated; then by name. */
export function compareStaffReportRows(a: StaffReportRow, b: StaffReportRow) {
  return SUBMISSION_ORDER[a.submission] - SUBMISSION_ORDER[b.submission] || REVIEW_ORDER[a.review] - REVIEW_ORDER[b.review] || a.name.localeCompare(b.name);
}

export function staffReportRows(enterprises: readonly ReportEnterprise[], reports: readonly IntakeReport[], month: ReportingMonth, today: Date): StaffReportRow[] {
  const forMonth = reports.filter((report) => sameMonth(intakeReportMonth(report), month));
  // An enterprise sends one report per month.
  const byEnterprise = new Map<string, IntakeReport>();
  for (const report of forMonth) if (!byEnterprise.has(report.enterpriseId)) byEnterprise.set(report.enterpriseId, report);

  // Registered enterprises, plus any enterprise that reported but is no longer in the list.
  const people = new Map(enterprises.map((enterprise) => [enterprise.id, { id: enterprise.id, name: enterprise.name, barangay: enterprise.barangay }]));
  for (const report of forMonth) if (!people.has(report.enterpriseId)) people.set(report.enterpriseId, { id: report.enterpriseId, name: report.enterprise, barangay: report.barangay });

  const rows = [...people.values()].map((enterprise): StaffReportRow => {
    const report = byEnterprise.get(enterprise.id);
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
      remind: !report,
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

const SUBMISSION_STATUSES: readonly SubmissionStatus[] = ["Missing", "Pending", "Submitted"];
const REVIEW_STATUSES: readonly ReviewStatus[] = ["Waiting", "Reviewing", "Consolidated"];

/** A status as the address writes it, lowercase with dashes for spaces: "Reviewing" is `reviewing`. */
function statusParam(status: string) {
  return status.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Filters from the address: `?q=&submission=missing&review=waiting&barangay=Poblacion`. */
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

/** The notice a reminder sends to the desktop app: send the month's report, before or after its due date. */
export function staffReminder(row: Pick<StaffReportRow, "submission">, monthLabel: string, due: string): StaffReminder {
  if (row.submission === "Missing") return { title: "Monthly report reminder", message: `Please send your ${monthLabel} monthly report. It was due ${due}.`, severity: "Warning" };
  return { title: "Monthly report reminder", message: `Please send your ${monthLabel} monthly report by ${due}.`, severity: "Info" };
}

// Progress and generation -------------------------------------------------------------------------

export type StaffReportsProgress = {
  /** Enterprises listed for the month: the registered ones plus any other that reported. */
  enterprises: number;
  /** Reports sent: waiting for staff, accepted or consolidated. */
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
  /**
   * Every enterprise sent its report and every report is accepted, so the consolidated report is
   * final. Otherwise generating makes (or updates) a Draft.
   */
  complete: boolean;
};

export function staffReportsProgress(rows: readonly StaffReportRow[]): StaffReportsProgress {
  const received = rows.filter((row) => row.report);
  const count = (status: ReviewStatus) => rows.filter((row) => row.review === status).length;
  const reviewing = count("Reviewing");
  const notSent = rows.filter((row) => !row.report);
  return {
    enterprises: rows.length,
    received: received.length,
    consolidated: count("Consolidated"),
    reviewing,
    waiting: count("Waiting"),
    readyReportIds: received.flatMap((row) => (row.report?.status === "Ready to Consolidate" ? [row.report.id] : [])),
    notSent,
    complete: received.length > 0 && notSent.length === 0 && reviewing === 0,
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

/** The month's consolidated report that is not archived: a Draft or the final report. */
export function openConsolidatedReport<T extends Pick<FinalReport, "period" | "status">>(reports: readonly T[], month: ReportingMonth): T | undefined {
  return reports.find((report) => report.status !== "Archived" && sameMonth(parseReportingPeriod(report.period), month));
}

export const GENERATE_LABEL = "Generate consolidated report";
export const UPDATE_DRAFT_LABEL = "Update draft consolidated report";

export type ConsolidateButton = {
  label: typeof GENERATE_LABEL | typeof UPDATE_DRAFT_LABEL;
  enabled: boolean;
  /** The month is not complete, so pressing warns first and the result is a Draft. */
  incomplete: boolean;
  /** Why the button cannot be pressed; null when it can. */
  reason: string | null;
};

/**
 * The Generate button. It works once at least one report is accepted, complete month or not: an
 * incomplete month gives a Draft that later accepted reports are added to, and the month's report
 * becomes final once every enterprise's report is in. A draft whose month is now complete (an
 * enterprise that never reported was deactivated) can be finalized with nothing new to add.
 */
export function consolidateButton(progress: Pick<StaffReportsProgress, "readyReportIds" | "complete" | "received">, existing: Pick<FinalReport, "status"> | undefined, monthLabel: string): ConsolidateButton {
  const draft = existing?.status === "Draft";
  const label = draft && !progress.complete ? UPDATE_DRAFT_LABEL : GENERATE_LABEL;
  const incomplete = !progress.complete;
  if (existing?.status === "Finalized") return { label: GENERATE_LABEL, enabled: false, incomplete, reason: `The ${monthLabel} consolidated report is final.` };
  if (progress.readyReportIds.length > 0 || (draft && progress.complete)) return { label, enabled: true, incomplete, reason: null };
  if (draft) return { label, enabled: false, incomplete, reason: "Accept another enterprise's report to update the draft." };
  return { label, enabled: false, incomplete, reason: progress.received ? "Accept at least one report to generate the consolidated report." : `No reports have been sent for ${monthLabel} yet.` };
}

/** "A draft consolidated report exists for October 2026, last updated Nov 28." */
export function draftReportNote(monthLabel: string, draft: Pick<FinalReport, "updatedAt" | "generatedOn">) {
  const updated = parseApiDate(draft.updatedAt) ?? parseApiDate(draft.generatedOn);
  return `A draft consolidated report exists for ${monthLabel}${updated ? `, last updated ${formatShortDate(updated)}` : ""}.`;
}

/** The fixed warning before consolidating an incomplete month. */
export const INCOMPLETE_SUBMISSIONS_TITLE = "Incomplete Report Submissions";
export const INCOMPLETE_SUBMISSIONS_MESSAGE = "Some enterprises have not yet submitted their reports. Are you sure you want to proceed with the consolidation?";

/**
 * What an incomplete consolidation leaves out: "3 of 11 enterprises have not sent a report. 2 sent
 * reports are still waiting for your review and will not be included."
 */
export function incompleteSubmissionsDetail(progress: Pick<StaffReportsProgress, "enterprises" | "notSent" | "reviewing">) {
  const notSent = progress.notSent.length;
  const reviewing = progress.reviewing;
  return [
    notSent ? `${notSent} of ${progress.enterprises} ${progress.enterprises === 1 ? "enterprise" : "enterprises"} ${notSent === 1 ? "has" : "have"} not sent a report.` : "",
    reviewing ? `${reviewing} sent ${reviewing === 1 ? "report is" : "reports are"} still waiting for your review and will not be included.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The Generate confirmation for a complete month: "Combine the 3 accepted reports into the October
 * 2026 monthly report (VAR 2M)." With a draft, the accepted reports are added to it. Enterprises
 * that have not sent a report are named, though a complete month has none.
 */
export function generateConfirmMessage(monthLabel: string, progress: Pick<StaffReportsProgress, "readyReportIds" | "notSent">, draft = false) {
  const accepted = progress.readyReportIds.length;
  const notSent = progress.notSent.length;
  const missing = notSent ? ` ${notSent} ${notSent === 1 ? "enterprise has" : "enterprises have"} not sent a report and will not be included.` : "";
  const reports = `${accepted} accepted ${accepted === 1 ? "report" : "reports"}`;
  if (draft && accepted === 0) return `Every report for ${monthLabel} is in the draft. Finalize the monthly report (VAR 2M).${missing}`;
  if (draft) return `Add the ${reports} to the ${monthLabel} draft and finalize the monthly report (VAR 2M).${missing}`;
  return `Combine the ${reports} into the ${monthLabel} monthly report (VAR 2M).${missing}`;
}

/** The toast after generating: a new draft, an updated draft, or the final report. */
export function consolidatedMessage(period: string, status: FinalReport["status"], hadDraft: boolean) {
  if (status !== "Draft") return `The ${period} consolidated report was generated.`;
  return hadDraft ? `The ${period} draft consolidated report was updated.` : `A draft of the ${period} consolidated report was saved.`;
}
