import type { ReportRecord } from "../../../types/enterprise";
import { isUploadRejected } from "./report-lifecycle";
import { isReportingPeriodOverdue } from "./reporting-calendar";

/** The only statuses Reports History shows, in the order its filter lists them. */
export const REPORTING_STATUSES = ["Pending", "Submitted", "Missing", "Consolidated"] as const;

export type ReportingStatus = (typeof REPORTING_STATUSES)[number];

/** The tint each status takes: amber, teal, red or green. */
export const REPORTING_STATUS_TONE: Record<ReportingStatus, "pending" | "submitted" | "missing" | "consolidated"> = {
  Pending: "pending",
  Submitted: "submitted",
  Missing: "missing",
  Consolidated: "consolidated",
};

/**
 * Where a month's report stands, in four words:
 *
 * - **Consolidated**: LGU Staff included it in the city's consolidated report; it is ready to print.
 * - **Submitted**: TANAW received it and it is not consolidated yet (waiting for or accepted by
 *   Staff review).
 * - **Pending**: not submitted yet and the due date (the 10th of the next month) has not passed:
 *   the open month's draft, a closed month before its due date, a report saved on this computer
 *   that waits to upload, or one TANAW refused.
 * - **Missing**: the same, once the due date has passed.
 *
 * `kind` is the ledger row's kind: the open period's draft (`current`), a closed period waiting
 * for its report (`pending`), or a report this establishment made (`history`).
 */
export function reportingStatus(kind: "current" | "pending" | "history", report: ReportRecord, now = new Date()): ReportingStatus {
  if (kind === "history" && (report.reviewStatus === "Consolidated" || report.status === "Consolidated")) return "Consolidated";
  if (kind === "history" && wasReceived(report)) return "Submitted";
  return isReportingPeriodOverdue(report.period ?? report.date, now) ? "Missing" : "Pending";
}

/** Whether a status means TANAW holds the month's report, so it can be printed and downloaded. */
export function isSubmittedStatus(status: ReportingStatus) {
  return status === "Submitted" || status === "Consolidated";
}

/**
 * Sent and received by TANAW: not a draft, not refused, and either uploaded or already under
 * Staff review. A report saved on this computer that waits to upload is not submitted yet.
 */
function wasReceived(report: ReportRecord) {
  if (report.status === "Draft" || isUploadRejected(report)) return false;
  return report.reviewStatus !== undefined || !report.syncStatus || report.syncStatus === "synced";
}
