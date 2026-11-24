import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import { formatShortDate, reportSentAt, reviewStatus, submissionNote, submissionStatus, type ReviewStatus, type SubmissionStatus } from "./reportStatuses";
import { formatReportingMonth, intakeReportMonth, sameMonth, type ReportingMonth } from "./reportingMonth";

/*
 * The Staff Reports screen: one row per registered enterprise for the chosen month, and what the
 * staff member can do with it.
 *
 *   Review         the report is waiting for a staff decision (stored "Pending Review").
 *   View           returned for correction, accepted, or already in a monthly report (read only).
 *   Send reminder  no report yet (Pending before the due date, Missing after it).
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
  /** "3 days after due", "Returned for correction", "Due Nov 10" or "12 days overdue". */
  note: string | null;
  action: StaffReportAction;
};

/** The newest report when an enterprise has more than one for the month. */
function latestReport(reports: readonly IntakeReport[]) {
  return reports.reduce<IntakeReport | undefined>((latest, report) => {
    if (!latest) return report;
    return (reportSentAt(report)?.getTime() ?? 0) > (reportSentAt(latest)?.getTime() ?? 0) ? report : latest;
  }, undefined);
}

function actionFor(report: IntakeReport | undefined): StaffReportAction {
  if (!report) return "remind";
  return report.status === "Pending Review" ? "review" : "view";
}

/** Work to do first: reports to review, then enterprises to remind, then returned, then consolidated. */
function rank(row: StaffReportRow) {
  if (row.action === "review") return 0;
  if (row.action === "remind") return 1;
  return row.review === "Reviewing" ? 2 : 3;
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
    };
  });
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
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

const SUBMISSION_STATUSES: readonly SubmissionStatus[] = ["Submitted", "Pending", "Missing"];
const REVIEW_STATUSES: readonly ReviewStatus[] = ["Waiting", "Reviewing", "Consolidated"];

/** Filters from the address: `?q=&submission=missing&review=waiting&barangay=Poblacion`. */
export function parseStaffReportFilters(params: URLSearchParams): StaffReportFilters {
  const pick = <T extends string>(values: readonly T[], value: string | null) => values.find((item) => item.toLowerCase() === value?.toLowerCase()) ?? "all";
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
    submission: filters.submission === "all" ? null : filters.submission.toLowerCase(),
    review: filters.review === "all" ? null : filters.review.toLowerCase(),
    barangay: filters.barangay === "all" ? null : filters.barangay,
  };
}

export function hasStaffReportFilters(filters: StaffReportFilters) {
  return Boolean(filters.query.trim()) || filters.submission !== "all" || filters.review !== "all" || filters.barangay !== "all";
}

export function rowMatchesFilters(row: StaffReportRow, filters: StaffReportFilters) {
  const query = filters.query.trim().toLowerCase();
  const matchesQuery = !query || [row.name, row.barangay, row.report?.code].some((value) => value?.toLowerCase().includes(query));
  return (
    matchesQuery &&
    (filters.submission === "all" || row.submission === filters.submission) &&
    // A month with no report shows Waiting too, but filtering by review means received reports.
    (filters.review === "all" || (Boolean(row.report) && row.review === filters.review)) &&
    (filters.barangay === "all" || row.barangay === filters.barangay)
  );
}

export function filterStaffReportRows(rows: readonly StaffReportRow[], filters: StaffReportFilters) {
  return rows.filter((row) => rowMatchesFilters(row, filters));
}

/** Dropdown options with how many enterprises each would show, given the other filters. */
export function staffReportFilterOptions(rows: readonly StaffReportRow[], filters: StaffReportFilters) {
  const countWith = (patch: Partial<StaffReportFilters>) => filterStaffReportRows(rows, { ...filters, ...patch }).length;
  const option = (value: string, label: string, patch: Partial<StaffReportFilters>) => ({ value, label, meta: String(countWith(patch)) });
  const barangays = [...new Set(rows.map((row) => row.barangay).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    submission: [option("all", "All submissions", { submission: "all" }), ...SUBMISSION_STATUSES.map((status) => option(status, status, { submission: status }))],
    review: [option("all", "All reviews", { review: "all" }), ...REVIEW_STATUSES.map((status) => option(status, status, { review: status }))],
    barangay: [option("all", "All barangays", { barangay: "all" }), ...barangays.map((name) => option(name, name, { barangay: name }))],
  };
}

// Progress and generation -------------------------------------------------------------------------

export type StaffReportsProgress = {
  received: number;
  consolidated: number;
  reviewing: number;
  waiting: number;
  /** Accepted reports not yet in a monthly report: what Generate would include. */
  readyReportIds: string[];
  notSent: StaffReportRow[];
  /** Every received report is accepted and at least one is not in a monthly report yet. */
  canGenerate: boolean;
  /** Every received report is already in a monthly report. */
  generated: boolean;
};

/**
 * Enterprises that have not sent a report do not block generation; the backend builds the monthly
 * report from the accepted reports it is given.
 */
export function staffReportsProgress(rows: readonly StaffReportRow[]): StaffReportsProgress {
  const received = rows.filter((row) => row.report);
  const count = (status: ReviewStatus) => received.filter((row) => row.review === status).length;
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
    canGenerate: allAccepted && readyReportIds.length > 0,
    generated: allAccepted && readyReportIds.length === 0,
  };
}

/** One line beside the filters saying whether the month can be generated yet. */
export function staffReportsSummary(progress: StaffReportsProgress, month: ReportingMonth) {
  const { received, consolidated } = progress;
  if (received === 0) return `No ${formatReportingMonth(month)} reports received yet.`;
  if (progress.generated) return "The consolidated report for this month has been generated.";
  if (progress.canGenerate) return received === 1 ? "The received report is consolidated. Ready to generate." : `All ${received} received reports are consolidated. Ready to generate.`;
  return `${consolidated} of ${received} received ${received === 1 ? "report" : "reports"} consolidated. Generate once ${received === 1 ? "it is" : `all ${received} are`}.`;
}
