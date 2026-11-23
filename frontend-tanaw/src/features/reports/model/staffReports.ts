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

// Tabs ------------------------------------------------------------------------------------------

/** "not-sent" holds the enterprises with no report; it is labelled Pending or Missing, like their pills. */
export const STAFF_REPORT_TABS = ["all", "waiting", "reviewing", "consolidated", "not-sent"] as const;
export type StaffReportsTab = (typeof STAFF_REPORT_TABS)[number];

export function parseStaffReportsTab(value: string | null | undefined): StaffReportsTab {
  return STAFF_REPORT_TABS.find((tab) => tab === value) ?? "all";
}

export function rowInTab(row: StaffReportRow, tab: StaffReportsTab) {
  if (tab === "all") return true;
  if (tab === "not-sent") return row.submission !== "Submitted";
  if (row.submission !== "Submitted") return false;
  return row.review.toLowerCase() === tab;
}

export function staffReportTabs(rows: readonly StaffReportRow[]) {
  const notSentLabel = rows.some((row) => row.submission === "Missing") || !rows.some((row) => row.submission === "Pending") ? "Missing" : "Pending";
  const labels: Record<StaffReportsTab, string> = { all: "All", waiting: "Waiting", reviewing: "Reviewing", consolidated: "Consolidated", "not-sent": notSentLabel };
  return STAFF_REPORT_TABS.map((value) => ({ value, label: labels[value], count: rows.filter((row) => rowInTab(row, value)).length }));
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

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
export function listNames(names: readonly string[], limit = 3) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > limit) return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function notSentSentence(rows: readonly StaffReportRow[]) {
  if (rows.length === 0) return "";
  const names = listNames(rows.map((row) => row.name));
  const yet = rows.every((row) => row.submission === "Pending") ? " yet" : "";
  return rows.length === 1 ? `${names} has not sent a report${yet}.` : `${names} have not sent reports${yet}.`;
}

/** The status line above the progress bar: a bold summary and the detail after it. */
export function staffReportsStatus(progress: StaffReportsProgress, month: ReportingMonth) {
  const notSent = notSentSentence(progress.notSent);
  if (progress.received === 0) {
    return { line: `No ${formatReportingMonth(month)} reports received yet.`, detail: notSent };
  }
  const line = `${progress.consolidated} of ${progress.received} received ${progress.received === 1 ? "report" : "reports"} consolidated.`;
  const next = progress.canGenerate
    ? "Ready to generate the consolidated report."
    : progress.generated
      ? "The consolidated report for this month has been generated."
      : `${progress.reviewing} reviewing, ${progress.waiting} waiting. Generate once all ${progress.received} are consolidated.`;
  return { line, detail: [next, notSent].filter(Boolean).join(" ") };
}

export function progressBarLabel(progress: StaffReportsProgress) {
  return `${progress.consolidated} consolidated, ${progress.reviewing} reviewing, ${progress.waiting} waiting`;
}
