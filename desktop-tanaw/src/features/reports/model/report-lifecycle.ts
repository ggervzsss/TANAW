import type { DemoBreakdown, ReportRecord } from "../../../types/enterprise";
import { formatPhilippineDateTime, type SystemTimeFormat } from "../../../utils/date-time";
import type { TicketDraftPrefill } from "../../tickets/model/ticket-draft";
import { formatReportingPeriodLabel, isSameReportingMonth, reportingMonthKey, reportingMonthSortValue } from "../utils/reporting-period";
import type { ReportDay } from "./daily-origins";

/**
 * Where a month's report stands once it leaves the draft: sent and waiting for Staff, refused by
 * TANAW, or being fixed after TANAW refused it.
 *
 * A month holds one report, and TANAW never replaces one it accepted. When TANAW refuses a
 * report's upload, the person can reopen it: the refused report stays in Reports History, and the
 * month opens as a draft again, starting from the refused report's figures.
 */
export type ReportLifecycle =
  | { kind: "draft" }
  /** The month's draft fixes `previous`, a report TANAW refused. */
  | { kind: "correcting"; previous: ReportRecord }
  | { kind: "upload_rejected"; report: ReportRecord }
  /** Saved on this computer; the upload waits for a connection. */
  | { kind: "waiting_to_send"; report: ReportRecord }
  | { kind: "sent"; report: ReportRecord };

/** A refused report reopened to be fixed no longer holds its month; it stays as history. */
export function isReopenedReport(report: ReportRecord) {
  return Boolean(report.reopenedAt);
}

/** Whether TANAW refused this report's upload; it is never retried on its own. */
export function isUploadRejected(report: ReportRecord) {
  return report.syncStatus === "upload_rejected";
}

/** The report that holds the month: the one not reopened, else the latest sent. */
export function latestMonthReport(reports: ReportRecord[], period: string): ReportRecord | null {
  let latest: ReportRecord | null = null;
  for (const report of reports) {
    if (report.status === "Draft" || !isSameReportingMonth(report.period ?? report.date, period)) continue;
    if (!latest || compareMonthReports(report, latest) > 0) latest = report;
  }
  return latest;
}

/** Orders two reports of one month: positive when `first` is the later one. */
export function compareMonthReports(first: ReportRecord, second: ReportRecord) {
  // A reopened report gave way to whatever came after it.
  const byLiveness = Number(!isReopenedReport(first)) - Number(!isReopenedReport(second));
  if (byLiveness !== 0) return byLiveness;
  return timestamp(first.submittedAt) - timestamp(second.submittedAt);
}

/** The refused report the month's draft fixes: the month's latest report, once it was reopened. */
export function correctionSource(reports: ReportRecord[], period: string): ReportRecord | null {
  const latest = latestMonthReport(reports, period);
  return latest && isReopenedReport(latest) ? latest : null;
}

/** What the open month shows: `activeReport` is a sent report, or null for the month's draft. */
export function reportLifecycle(activeReport: ReportRecord | null, reports: ReportRecord[], period: string): ReportLifecycle {
  if (!activeReport) {
    const previous = correctionSource(reports, period);
    return previous ? { kind: "correcting", previous } : { kind: "draft" };
  }
  if (activeReport.status === "Draft") return { kind: "draft" };
  if (isUploadRejected(activeReport)) return { kind: "upload_rejected", report: activeReport };
  if (activeReport.syncStatus && activeReport.syncStatus !== "synced") return { kind: "waiting_to_send", report: activeReport };
  return { kind: "sent", report: activeReport };
}

/** Months whose report TANAW refused and that have not been reopened yet. Newest month first. */
export function reportsNeedingAction(reports: ReportRecord[]) {
  const latestByMonth = new Map<string, ReportRecord>();
  for (const report of reports) {
    if (report.status === "Draft") continue;
    const key = reportingMonthKey(report.period ?? report.date);
    const latest = latestByMonth.get(key);
    if (!latest || compareMonthReports(report, latest) > 0) latestByMonth.set(key, report);
  }
  return [...latestByMonth.values()]
    .filter((report) => !isReopenedReport(report) && isUploadRejected(report))
    .sort((first, second) => reportingMonthSortValue(second.period ?? second.date) - reportingMonthSortValue(first.period ?? first.date));
}

/** Whether the person can still reopen this refused report: it still holds its month. */
export function canReopenReport(report: ReportRecord, reports: ReportRecord[]) {
  if (isReopenedReport(report) || !isUploadRejected(report)) return false;
  const latest = latestMonthReport(reports, report.period ?? report.date);
  return !latest || latest.id === report.id;
}

/** The code people see for a report: TANAW's own once known, else this computer's reference. */
export function reportReference(report: ReportRecord) {
  return report.reference || report.id;
}

/** "Nov 3, 2026 at 4:12 PM" in Philippine time. */
export function formatSentAt(value: string, timeFormat: SystemTimeFormat) {
  if (Number.isNaN(Date.parse(value))) return value;
  return `${formatPhilippineDateTime(value, timeFormat, { dateStyle: "medium" })} at ${formatPhilippineDateTime(value, timeFormat, { timeStyle: "short" })}`;
}

/** "Sent on Nov 3, 2026 at 4:12 PM · Reference REP-…". */
export function sentConfirmationText(report: ReportRecord, timeFormat: SystemTimeFormat) {
  const waiting = Boolean(report.syncStatus && report.syncStatus !== "synced");
  const when = report.submittedAt ? `${waiting ? "Saved on this computer on" : "Sent on"} ${formatSentAt(report.submittedAt, timeFormat)}` : waiting ? "Saved on this computer" : "Sent";
  return `${when} · Reference ${reportReference(report)}`;
}

export type ReviewTone = "waiting" | "accepted" | "consolidated" | "rejected" | "pending";

/** Where Staff's review stands, in the words front-desk staff use. */
export function reviewState(report: ReportRecord): { text: string; tone: ReviewTone } {
  if (isUploadRejected(report)) return { text: "Not accepted by TANAW", tone: "rejected" };
  if (report.syncStatus && report.syncStatus !== "synced") return { text: "Waiting to send", tone: "pending" };
  if (report.reviewStatus === "Consolidated" || report.status === "Consolidated") {
    const month = formatReportingPeriodLabel(report.period ?? report.date).split(" ")[0];
    return { text: `Included in the ${month} consolidated report`, tone: "consolidated" };
  }
  if (report.reviewStatus === "Ready to Consolidate") return { text: "Accepted by Staff", tone: "accepted" };
  return { text: "Waiting for Staff review", tone: "waiting" };
}

/** The submit dialog's question; fixing a report TANAW refused says so. */
export function submitDialogTitle(period: string, isCorrection: boolean) {
  const month = formatReportingPeriodLabel(period);
  return isCorrection ? `Send the corrected ${month} report?` : `Send your ${month} report to the LGU?`;
}

export type OriginSplit = { thisCity: number; otherCities: number; otherProvinces: number; foreign: number };

/** Where the month's visitors came from, as whole numbers. This Province includes This City. */
export function originSplit(demo: DemoBreakdown): OriginSplit {
  const thisCity = count(demo.thisCityMale) + count(demo.thisCityFemale) + count(demo.thisCityUnspecified);
  const thisProvince = count(demo.thisProvMale) + count(demo.thisProvFemale) + count(demo.thisProvUnspecified);
  return {
    thisCity,
    otherCities: Math.max(0, thisProvince - thisCity),
    otherProvinces: count(demo.otherProvMale) + count(demo.otherProvFemale),
    foreign: count(demo.foreignMale) + count(demo.foreignFemale),
  };
}

/** The days of the month the report covers, and how many of them TANAW counted visitors on. */
export function reportDayCoverage(days: ReportDay[]) {
  return { total: days.length, counted: days.filter((day) => day.unique !== null).length };
}

/**
 * A request to IT about a report TANAW refused, for the Requests form: the month, the reference
 * and TANAW's own message, so IT can look it up without asking.
 */
export function rejectedUploadTicketDraft(report: ReportRecord, timeFormat: SystemTimeFormat): TicketDraftPrefill {
  const month = formatReportingPeriodLabel(report.period ?? report.date);
  const reason = report.rejectionReason?.trim().slice(0, 1000) || "TANAW did not give a reason.";
  const lines = [
    `TANAW did not accept the ${month} report sent from this establishment's desktop app.`,
    "",
    `Reference: ${reportReference(report)}`,
    `Reporting period: ${month}`,
    ...(report.submittedAt ? [`Sent on: ${formatSentAt(report.submittedAt, timeFormat)}`] : []),
    `Message from TANAW: ${reason}`,
    "",
    "Please help us send this report.",
  ];
  return { category: "Report problem", subject: `TANAW did not accept the ${month} report`, description: lines.join("\n") };
}

function count(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function timestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}
