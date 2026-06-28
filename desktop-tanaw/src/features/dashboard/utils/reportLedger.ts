import type { LocalReportSubmissionRecord } from "../../camera/services/ml-service";
import type { DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { getDemographicTotals } from "../../reports/utils/demographics";

export function reportFromLocalSubmission(submission: LocalReportSubmissionRecord): ReportRecord {
  const payload = submission.payload;
  const payloadStatus = typeof payload.status === "string" && isReportStatus(payload.status) ? payload.status : "Submitted";
  const payloadNotes = typeof payload.notes === "string" ? payload.notes : undefined;

  return {
    id: submission.report_id,
    date: submission.period,
    status: payloadStatus,
    entries: submission.entries,
    exits: submission.exits,
    peak: submission.peak_occupancy,
    unique: submission.unique_count,
    period: periodFromValue(submission.period),
    demo: demoFromPayload(payload.demo),
    notes: payloadNotes ?? submission.notes ?? "",
    submittedAt: submission.submitted_at,
    syncStatus: submission.sync_status,
  };
}

export function emptyDemo(): DemoBreakdown {
  return {
    thisProvMale: "",
    thisProvFemale: "",
    otherProvMale: "",
    otherProvFemale: "",
    foreignMale: "",
    foreignFemale: "",
  };
}

export function metricsFromReport(report: ReportRecord): Metrics {
  return {
    entries: report.entries,
    exits: report.exits ?? 0,
    peak: report.peak ?? Math.max(0, report.entries - (report.exits ?? 0)),
    unique: report.unique,
  };
}

export function hasDemographics(report: ReportRecord) {
  return getDemographicTotals(report.demo ?? emptyDemo()).grandTotal > 0;
}

export function sortReportsBySubmittedAt(reports: ReportRecord[]) {
  return [...reports].sort((first, second) => reportTimestamp(second) - reportTimestamp(first));
}

function demoFromPayload(value: unknown): DemoBreakdown {
  const fallback = emptyDemo();
  if (!value || typeof value !== "object") return fallback;

  const payload = value as Partial<Record<keyof DemoBreakdown, unknown>>;
  return {
    thisProvMale: stringValue(payload.thisProvMale),
    thisProvFemale: stringValue(payload.thisProvFemale),
    otherProvMale: stringValue(payload.otherProvMale),
    otherProvFemale: stringValue(payload.otherProvFemale),
    foreignMale: stringValue(payload.foreignMale),
    foreignFemale: stringValue(payload.foreignFemale),
  };
}

function periodFromValue(value: string): SystemLogPeriod {
  return value || "Current Period";
}

function isReportStatus(value: string) {
  return ["Submitted", "Resubmitted", "Consolidated", "Returned for Revision", "Draft"].includes(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : "";
}

function reportTimestamp(report: ReportRecord) {
  const timestamp = Date.parse(report.submittedAt ?? report.date);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
