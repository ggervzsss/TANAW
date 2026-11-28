import type { IntakeReport } from "@/shared/types";
import { reportVersion } from "./reportStatuses";

/*
 * Returning a report for correction. Staff write what the enterprise needs to correct; the
 * enterprise sees it in the desktop app and sends a corrected version, which arrives as the
 * month's next report version. The backend trims the reason and takes 10 to 500 characters.
 */

export const RETURN_REASON_MIN_LENGTH = 10;
export const RETURN_REASON_MAX_LENGTH = 500;

/** What is wrong with a return reason, or null when it can be sent. */
export function returnReasonError(reason: string, enterprise: string): string | null {
  const length = reason.trim().length;
  if (length === 0) return `Say what ${enterprise} needs to correct.`;
  if (length < RETURN_REASON_MIN_LENGTH) return `Write at least ${RETURN_REASON_MIN_LENGTH} characters so ${enterprise} knows what to correct.`;
  if (length > RETURN_REASON_MAX_LENGTH) return `Keep the reason to ${RETURN_REASON_MAX_LENGTH} characters or fewer.`;
  return null;
}

/** "120 of 500 characters" */
export function returnReasonCount(reason: string) {
  return `${reason.length} of ${RETURN_REASON_MAX_LENGTH} characters`;
}

/** What returning means, said before staff confirm it. */
export function returnReportExplanation(enterprise: string) {
  return `${enterprise} will see your reason in the desktop app and can send a corrected version. This report will not be included in the consolidated report until then.`;
}

/** Whether staff can still return the report: it waits for review or is accepted, and is not in a consolidated report. */
export function canReturnReport(report: Pick<IntakeReport, "status">) {
  return report.status === "Pending Review" || report.status === "Ready to Consolidate";
}

/** "Replaces version 1 (returned: <reason>)", for a corrected report; null for a first report. */
export function replacedVersionNote(report: Pick<IntakeReport, "version">, previous: Pick<IntakeReport, "version" | "returnedReason"> | undefined) {
  const version = reportVersion(report);
  if (version <= 1) return null;
  const replaced = `Replaces version ${previous ? reportVersion(previous) : version - 1}`;
  const reason = previous?.returnedReason?.trim();
  return reason ? `${replaced} (returned: ${reason})` : `${replaced}, which was returned for correction.`;
}
