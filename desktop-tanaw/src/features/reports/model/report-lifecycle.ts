import type { DemoBreakdown, ReportRecord } from "../../../types/enterprise";
import { formatPhilippineDateTime, type SystemTimeFormat } from "../../../utils/date-time";
import type { TicketDraftPrefill } from "../../tickets/model/ticket-draft";
import { formatReportingPeriodLabel, isSameReportingMonth, reportingMonthKey, reportingMonthSortValue } from "../utils/reporting-period";
import type { ReportDay } from "./daily-origins";

/**
 * Where a month's report stands once it leaves the draft: sent and waiting for Staff, returned
 * for correction, refused by TANAW, or being corrected as a new version.
 *
 * A month holds one live report. When Staff return it, or TANAW refuses its upload, the person
 * can reopen it: that version stays in Reports History, and the month opens as a draft again,
 * starting from the reopened version's figures. Sending the draft adds the next version.
 */
export type CorrectionCause = "returned" | "upload_rejected";

export type ReportLifecycle =
  | { kind: "draft" }
  /** The month's draft corrects `previous`; it will be sent as `version`. */
  | { kind: "correcting"; cause: CorrectionCause; previous: ReportRecord; version: number }
  | { kind: "returned"; report: ReportRecord }
  | { kind: "upload_rejected"; report: ReportRecord }
  /** Saved on this computer; the upload waits for a connection. */
  | { kind: "waiting_to_send"; report: ReportRecord }
  | { kind: "sent"; report: ReportRecord };

/** A version reopened for correction no longer holds its month; it stays as history. */
export function isReopenedReport(report: ReportRecord) {
  return Boolean(report.reopenedAt);
}

/** Whether Staff returned this version for correction. */
export function isReturnedReport(report: ReportRecord) {
  return report.reviewStatus === "Returned" || report.status === "Returned";
}

/** Whether TANAW refused this version's upload; it is never retried on its own. */
export function isUploadRejected(report: ReportRecord) {
  return report.syncStatus === "upload_rejected";
}

/** The version number, 1 when the report predates versions. */
export function reportVersion(report: ReportRecord) {
  return typeof report.version === "number" && Number.isInteger(report.version) && report.version >= 1 ? report.version : 1;
}

/** The month's latest sent version: the highest version, then the latest sent. */
export function latestReportVersion(reports: ReportRecord[], period: string): ReportRecord | null {
  let latest: ReportRecord | null = null;
  for (const report of reports) {
    if (report.status === "Draft" || !isSameReportingMonth(report.period ?? report.date, period)) continue;
    if (!latest || compareVersions(report, latest) > 0) latest = report;
  }
  return latest;
}

/** Orders two versions of one month: positive when `first` is the later one. */
export function compareVersions(first: ReportRecord, second: ReportRecord) {
  const byVersion = reportVersion(first) - reportVersion(second);
  if (byVersion !== 0) return byVersion;
  // A reopened version gave way to whatever came after it.
  const byLiveness = Number(!isReopenedReport(first)) - Number(!isReopenedReport(second));
  if (byLiveness !== 0) return byLiveness;
  return timestamp(first.submittedAt) - timestamp(second.submittedAt);
}

/** The version the month's draft corrects: its latest version, once that one was reopened. */
export function correctionSource(reports: ReportRecord[], period: string): ReportRecord | null {
  const latest = latestReportVersion(reports, period);
  return latest && isReopenedReport(latest) ? latest : null;
}

export function correctionCause(report: ReportRecord): CorrectionCause {
  return isUploadRejected(report) && !isReturnedReport(report) ? "upload_rejected" : "returned";
}

/**
 * The version a correction is sent as. A version Staff returned counts, so its correction is the
 * next one; a version TANAW never accepted does not, so its fix keeps the number.
 */
export function correctionVersion(previous: ReportRecord) {
  return reportVersion(previous) + (correctionCause(previous) === "returned" ? 1 : 0);
}

/** What the open month shows: `activeReport` is a sent version, or null for the month's draft. */
export function reportLifecycle(activeReport: ReportRecord | null, reports: ReportRecord[], period: string): ReportLifecycle {
  if (!activeReport) {
    const previous = correctionSource(reports, period);
    return previous ? { kind: "correcting", cause: correctionCause(previous), previous, version: correctionVersion(previous) } : { kind: "draft" };
  }
  if (activeReport.status === "Draft") return { kind: "draft" };
  if (isReturnedReport(activeReport)) return { kind: "returned", report: activeReport };
  if (isUploadRejected(activeReport)) return { kind: "upload_rejected", report: activeReport };
  if (activeReport.syncStatus && activeReport.syncStatus !== "synced") return { kind: "waiting_to_send", report: activeReport };
  return { kind: "sent", report: activeReport };
}

/**
 * Months whose latest version waits on the person: Staff returned it, or TANAW refused it, and it
 * has not been reopened yet. Newest month first.
 */
export function reportsNeedingAction(reports: ReportRecord[]) {
  const latestByMonth = new Map<string, ReportRecord>();
  for (const report of reports) {
    if (report.status === "Draft") continue;
    const key = reportingMonthKey(report.period ?? report.date);
    const latest = latestByMonth.get(key);
    if (!latest || compareVersions(report, latest) > 0) latestByMonth.set(key, report);
  }
  return [...latestByMonth.values()]
    .filter((report) => !isReopenedReport(report) && (isReturnedReport(report) || isUploadRejected(report)))
    .sort((first, second) => reportingMonthSortValue(second.period ?? second.date) - reportingMonthSortValue(first.period ?? first.date));
}

/** Whether the person can still reopen this version: it is the month's live version. */
export function canReopenReport(report: ReportRecord, reports: ReportRecord[]) {
  if (isReopenedReport(report)) return false;
  const latest = latestReportVersion(reports, report.period ?? report.date);
  return !latest || latest.id === report.id;
}

/** The code people see for a report: TANAW's own once known, else this computer's reference. */
export function reportReference(report: ReportRecord) {
  return report.reference || report.id;
}

/** "Version 2" for a correction; nothing for a month's first report. */
export function versionLabel(version: number) {
  return version > 1 ? `Version ${version}` : null;
}

/** "Nov 3, 2026 at 4:12 PM" in Philippine time. */
export function formatSentAt(value: string, timeFormat: SystemTimeFormat) {
  if (Number.isNaN(Date.parse(value))) return value;
  return `${formatPhilippineDateTime(value, timeFormat, { dateStyle: "medium" })} at ${formatPhilippineDateTime(value, timeFormat, { timeStyle: "short" })}`;
}

/** "Sent on Nov 3, 2026 at 4:12 PM · Reference REP-… · Version 2". */
export function sentConfirmationText(report: ReportRecord, timeFormat: SystemTimeFormat) {
  const waiting = Boolean(report.syncStatus && report.syncStatus !== "synced");
  const when = report.submittedAt ? `${waiting ? "Saved on this computer on" : "Sent on"} ${formatSentAt(report.submittedAt, timeFormat)}` : waiting ? "Saved on this computer" : "Sent";
  return [when, `Reference ${reportReference(report)}`, versionLabel(reportVersion(report))].filter(Boolean).join(" · ");
}

export type ReviewTone = "waiting" | "accepted" | "consolidated" | "returned" | "rejected" | "pending";

/** Where Staff's review stands, in the words front-desk staff use. */
export function reviewState(report: ReportRecord): { text: string; tone: ReviewTone } {
  if (isReturnedReport(report)) return { text: "Returned for correction", tone: "returned" };
  if (isUploadRejected(report)) return { text: "Not accepted by TANAW", tone: "rejected" };
  if (report.syncStatus && report.syncStatus !== "synced") return { text: "Waiting to send", tone: "pending" };
  if (report.reviewStatus === "Consolidated" || report.status === "Consolidated") {
    const month = formatReportingPeriodLabel(report.period ?? report.date).split(" ")[0];
    return { text: `Included in the ${month} consolidated report`, tone: "consolidated" };
  }
  if (report.reviewStatus === "Ready to Consolidate") return { text: "Accepted by Staff", tone: "accepted" };
  return { text: "Waiting for Staff review", tone: "waiting" };
}

/** "Returned for correction by Ana Cruz on Nov 5, 2026". */
export function returnedHeadline(report: ReportRecord, timeFormat: SystemTimeFormat) {
  const by = report.returnedBy?.trim() || "LGU Staff";
  const on = report.returnedAt && !Number.isNaN(Date.parse(report.returnedAt)) ? ` on ${formatPhilippineDateTime(report.returnedAt, timeFormat, { dateStyle: "medium" })}` : "";
  return `Returned for correction by ${by}${on}`;
}

/** The submit dialog's question; a correction says so. */
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
    ...(versionLabel(reportVersion(report)) ? [`Version: ${reportVersion(report)}`] : []),
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
