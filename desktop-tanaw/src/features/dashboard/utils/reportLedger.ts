import type { LocalReportSubmissionRecord } from "../../camera/services/ml-service";
import type { DemoBreakdown, Metrics, ReportRecord } from "../../../types/enterprise";
import { demographicEvidenceFromFacts, getDemographicTotals } from "../../reports/utils/demographics";
import { canonicalReportingPeriodFromSource } from "../../reports/services/reporting-period";

export function reportFromLocalSubmission(submission: LocalReportSubmissionRecord): ReportRecord {
  const payload = submission.payload;
  const payloadStatus = typeof payload.status === "string" && isReportStatus(payload.status) ? payload.status : "Submitted";
  const payloadNotes = typeof payload.notes === "string" ? payload.notes : undefined;
  const metrics = metricsFromLocalSubmission(submission);
  const reportingPeriod = canonicalReportingPeriodFromSource(submission);
  const demo = demoFromPayload(payload.demo);

  return {
    id: submission.report_id,
    date: reportingPeriod.label,
    status: payloadStatus,
    entries: metrics.entries,
    exits: metrics.exits,
    peak: metrics.peak,
    unique: metrics.unique,
    period: reportingPeriod.label,
    reportingPeriod,
    demo,
    demographicEvidence: demographicEvidenceFromFacts(payload.demographicFacts, demo) ?? undefined,
    notes: payloadNotes ?? submission.notes ?? "",
    submittedAt: submission.submitted_at,
    syncStatus: submission.sync_status,
  };
}

function metricsFromLocalSubmission(submission: LocalReportSubmissionRecord): Metrics {
  const payloadMetrics = submission.payload.metrics;
  if (payloadMetrics && typeof payloadMetrics === "object") {
    const metrics = payloadMetrics as Record<string, unknown>;
    const entries = nonNegativeInteger(metrics.entries);
    const exits = nonNegativeInteger(metrics.exits);
    const peak = nonNegativeInteger(metrics.peak ?? metrics.peakOccupancy ?? metrics.peak_occupancy);
    const unique = nonNegativeInteger(metrics.unique ?? metrics.uniqueCount ?? metrics.unique_count);
    if (entries !== null && exits !== null && peak !== null && unique !== null) {
      return { entries, exits: Math.min(exits, entries), peak, unique };
    }
  }

  return {
    entries: submission.entries,
    exits: submission.exits,
    peak: submission.peak_occupancy,
    unique: submission.unique_count,
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

function isReportStatus(value: string) {
  return ["Submitted", "Resubmitted", "Consolidated", "Returned for Revision", "Draft"].includes(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : "";
}

function nonNegativeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function reportTimestamp(report: ReportRecord) {
  const timestamp = Date.parse(report.submittedAt ?? report.date);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
