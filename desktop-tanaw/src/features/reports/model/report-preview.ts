import type { DailyOrigins, Metrics, ReportRecord } from "../../../types/enterprise";
import { isSameReportingMonth } from "../utils/reporting-period";
import { dailyOriginsError, reportDays } from "./daily-origins";
import type { ReportLedgerRow } from "./report-ledger";
import { isReopenedReport, isUploadRejected } from "./report-lifecycle";
import { isSubmittedStatus } from "./report-status";
import { getReportingPeriodSubmissionError } from "./reporting-calendar";

/** The report shown in Review Report Form. */
export type PreviewedReport = { reportId: string; period: string; metrics: Metrics; origins?: DailyOrigins };

/**
 * The buttons at the foot of Review Report Form:
 *
 * - `export`: Print and Download PDF, once TANAW holds the month's report (Submitted or Consolidated).
 * - `submit-open`: Submit Form for the editable month open in Create Reports.
 * - `submit-month`: Submit Form for another month (Pending or Missing). Pressing it opens that
 *   month in Create Reports, then submits it there; `blocker` says why it cannot be sent yet.
 */
export type PreviewActions = { kind: "export" } | { kind: "submit-open" } | { kind: "submit-month"; period: string; blocker: string | null };

export const REFUSED_REPORT_BLOCKER = "TANAW did not accept this report. Open its month in Create Reports and choose Fix and send again.";
export const WAITING_REPORT_BLOCKER = "This report is saved on this computer and waits to upload. TANAW sends it when the connection is back.";

/**
 * Why a report this establishment already sent cannot be submitted again: TANAW refused it (it is
 * fixed and sent from its month in Create Reports), or it is still waiting to upload. Null for a
 * draft, or for a refused report already reopened, whose month is sent from its fix.
 */
export function sentReportBlocker(report: ReportRecord) {
  if (report.status === "Draft" || isReopenedReport(report)) return null;
  return isUploadRejected(report) ? REFUSED_REPORT_BLOCKER : WAITING_REPORT_BLOCKER;
}

/** The Reports History row the preview shows: the report itself, else its month's draft. */
export function previewLedgerRow(rows: ReportLedgerRow[], preview: PreviewedReport) {
  const sameMonth = (row: ReportLedgerRow) => isSameReportingMonth(row.report.period ?? row.report.date, preview.period);
  return rows.find((row) => row.report.id === preview.reportId && sameMonth(row)) ?? rows.find((row) => row.kind !== "history" && sameMonth(row)) ?? null;
}

export function previewActions({
  preview,
  rows,
  openPeriod,
  openIsEditable,
  now = new Date(),
}: {
  preview: PreviewedReport;
  rows: ReportLedgerRow[];
  /** The month open in Create Reports. */
  openPeriod: string;
  /** Whether that month is a draft that can still be sent. */
  openIsEditable: boolean;
  now?: Date;
}): PreviewActions {
  const row = previewLedgerRow(rows, preview);
  const isOpenDraft = openIsEditable && isSameReportingMonth(preview.period, openPeriod);
  if (!row) return isOpenDraft ? { kind: "submit-open" } : { kind: "export" };
  if (isSubmittedStatus(row.statusLabel)) return { kind: "export" };
  if (isOpenDraft) return { kind: "submit-open" };
  return { kind: "submit-month", period: row.report.period ?? row.report.date, blocker: submitBlocker(row, preview, now) };
}

/** What stops another month from being sent, as far as can be told before it is opened. */
function submitBlocker(row: ReportLedgerRow, preview: PreviewedReport, now: Date) {
  const sent = row.kind === "history" ? sentReportBlocker(row.report) : null;
  if (sent) return sent;
  const periodError = getReportingPeriodSubmissionError(preview.period, now);
  if (periodError) return periodError;
  // A refused report's month is sent from its fix, whose origins are not the ones shown here.
  return row.kind === "history" ? null : dailyOriginsError(reportDays(preview.period, preview.metrics, preview.origins));
}
