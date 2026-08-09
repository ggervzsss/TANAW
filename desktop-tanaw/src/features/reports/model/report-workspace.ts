import type { DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { type LocalMetricsSummary, type LocalReportSubmissionRecord } from "../../camera/services/ml-service";
import type { BackendSamplePreparationCounts } from "../../sync/services/cloud-sync";
import type { EnterpriseIntakeReport } from "../services/report-history";
import { getDemographicAllocationStatus, getDemographicTotals } from "../utils/demographics";
import { isSameReportingMonth, reportingMonthKey } from "../utils/reporting-period";
import { sortReportLedgerRows } from "../utils/report-ledger";
import type { ReportLedgerRow } from "./report-ledger";
import { formatPhilippineDateTime, type SystemTimeFormat } from "../../../utils/date-time";
import { getCurrentReportingPeriod, getReportingPeriodSubmissionError } from "./reporting-calendar";

export function validateReportDraft(
  metrics: Metrics,
  demo: DemoBreakdown,
  period: string,
  reports: ReportRecord[],
  activeReportId: string | null,
  options: { checkDuplicatePeriod: boolean; checkReportingPeriod: boolean },
) {
  if (options.checkReportingPeriod) {
    const periodSubmissionError = getReportingPeriodSubmissionError(period);
    if (periodSubmissionError) return periodSubmissionError;
  }
  const allocationError = validateDemographicAllocation(metrics, demo);
  if (allocationError) return allocationError;
  if (options.checkDuplicatePeriod && reports.some((report) => report.id !== activeReportId && report.period === period && report.status !== "Draft")) {
    return `A report for ${period} has already been submitted.`;
  }
  return null;
}

export function validateDemographicAllocation(metrics: Metrics, demo: DemoBreakdown) {
  return getDemographicAllocationStatus(demo, metrics.unique).validationMessage;
}

export function metricsFromReport(report: ReportRecord): Metrics {
  return {
    entries: report.entries,
    exits: report.exits ?? 0,
    peak: report.peak ?? Math.max(0, report.entries - (report.exits ?? 0)),
    unique: report.unique,
  };
}

export function metricsFromSummary(summary: LocalMetricsSummary): Metrics {
  return {
    entries: summary.entries,
    exits: summary.exits,
    peak: summary.peak_occupancy,
    unique: summary.unique_count,
  };
}

export function metricsFromPendingCounts(counts: BackendSamplePreparationCounts): Metrics {
  return {
    entries: counts.entries,
    exits: counts.exits,
    peak: counts.peakOccupancy,
    unique: counts.uniqueCount,
  };
}

export function isPreparedMetrics(value: unknown): value is LocalMetricsSummary & { prepared: boolean } {
  return Boolean(value && typeof value === "object" && "entries" in value && "period" in value);
}

export function getDemographicDraftKey(activeReportId: string | null, period: string) {
  return activeReportId ? `report:${activeReportId}` : `period:${period || getCurrentReportingPeriod()}`;
}

export function buildLedgerRows({
  currentDemo,
  currentMetrics,
  currentNotes,
  currentPeriod,
  pendingCounts,
  reportsHistory,
}: {
  currentDemo: DemoBreakdown;
  currentMetrics: Metrics;
  currentNotes: string;
  currentPeriod: SystemLogPeriod;
  pendingCounts: BackendSamplePreparationCounts[];
  reportsHistory: ReportRecord[];
}): ReportLedgerRow[] {
  const reportedPeriods = new Set(reportsHistory.map((report) => reportingMonthKey(report.period ?? report.date)));
  const pendingPeriods = new Set<string>();
  const rows: ReportLedgerRow[] = [
    {
      key: draftLedgerKey(currentPeriod),
      kind: "current",
      report: {
        id: "TANAW-DRAFT",
        date: currentPeriod,
        status: "Draft",
        entries: currentMetrics.entries,
        exits: currentMetrics.exits,
        peak: currentMetrics.peak,
        unique: currentMetrics.unique,
        period: currentPeriod,
        demo: currentDemo,
        notes: currentNotes,
      },
      reportLabel: "Current Reporting Period",
      reportDescription: "Live workspace",
      statusLabel: "Current Reporting Period",
    },
  ];

  for (const counts of pendingCounts) {
    const countsPeriodKey = reportingMonthKey(counts.period);
    if (isSameReportingMonth(counts.period, currentPeriod) || reportedPeriods.has(countsPeriodKey) || pendingPeriods.has(countsPeriodKey)) continue;
    pendingPeriods.add(countsPeriodKey);
    rows.push({
      key: draftLedgerKey(counts.period),
      kind: "pending",
      report: reportFromPendingCounts(counts),
      reportLabel: "Pending Submission",
      reportDescription: "Prepared counts",
      statusLabel: "Pending Submission",
    });
  }

  rows.push(
    ...reportsHistory.map((report) => ({
      key: historyLedgerKey(report.id),
      kind: "history" as const,
      report,
      reportLabel: report.id,
      reportDescription: report.syncStatus ? `Online copy: ${uploadStatusLabel(report.syncStatus)}` : "Saved report",
      statusLabel: report.status,
    })),
  );

  return sortReportLedgerRows(rows);
}

function reportFromPendingCounts(counts: BackendSamplePreparationCounts): ReportRecord {
  return {
    id: counts.reportId,
    date: counts.period,
    status: "Draft",
    entries: counts.entries,
    exits: counts.exits,
    peak: counts.peakOccupancy,
    unique: counts.uniqueCount,
    period: counts.period,
    demo: emptyDemo(),
    notes: "",
  };
}

export function draftLedgerKey(period: string) {
  return `draft:${reportingMonthKey(period)}`;
}

export function historyLedgerKey(reportId: string) {
  return `history:${reportId}`;
}

export function reportFromLocalSubmission(submission: LocalReportSubmissionRecord, timeFormat: SystemTimeFormat): ReportRecord {
  const payload = submission.payload;
  const payloadStatus = typeof payload.status === "string" && isReportStatus(payload.status) ? payload.status : "Submitted";
  const payloadNotes = typeof payload.notes === "string" ? payload.notes : undefined;
  const metrics = metricsFromLocalSubmission(submission);

  return {
    id: submission.report_id,
    date: submission.period,
    status: payloadStatus,
    entries: metrics.entries,
    exits: metrics.exits,
    peak: metrics.peak,
    unique: metrics.unique,
    period: periodFromValue(submission.period),
    demo: demoFromPayload(payload.demo),
    notes: payloadNotes ?? submission.notes ?? "",
    auditTrail: auditTrailFromPayload(payload.auditTrail) ?? [
      {
        time: formatAuditTime(submission.submitted_at, timeFormat),
        action: payloadStatus === "Resubmitted" ? "Report Resubmitted" : "Report Submitted",
        actor: "Enterprise User",
      },
    ],
    remarks: null,
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

export function reportFromCloudSubmission(report: EnterpriseIntakeReport, timeFormat: SystemTimeFormat): ReportRecord {
  const peak = typeof report.metrics.peak === "number" ? report.metrics.peak : Number(report.metrics.peak) || 0;
  const payloadStatus = typeof report.payload?.status === "string" && isReportStatus(report.payload.status) ? report.payload.status : "Submitted";
  const status = report.status === "Returned" ? "Returned for Revision" : report.status === "Consolidated" ? "Consolidated" : report.status === "Pending Review" ? payloadStatus : "Submitted";
  return {
    id: report.code,
    date: report.period,
    status,
    entries: report.metrics.entry,
    exits: report.metrics.exit,
    peak,
    unique: report.metrics.unique,
    period: report.period,
    demo: demoFromPayload(report.payload?.demo),
    notes: report.notes ?? "",
    remarks: report.remarks,
    submittedAt: report.submittedAt,
    syncStatus: "synced",
    auditTrail: [
      {
        time: formatAuditTime(report.submittedAt, timeFormat),
        action: status === "Consolidated" ? "Report Consolidated" : status === "Returned for Revision" ? "Report Returned" : "Report Submitted",
        actor: status === "Submitted" ? "Enterprise User" : "LGU Staff",
      },
    ],
  };
}

export function mergeReportHistory(localReports: ReportRecord[], cloudReports: ReportRecord[]) {
  const reportsById = new Map<string, ReportRecord>();

  for (const report of localReports) {
    reportsById.set(report.id, report);
  }

  for (const report of cloudReports) {
    const localReport = reportsById.get(report.id);
    if (!localReport) {
      reportsById.set(report.id, report);
      continue;
    }

    if (isPendingLocalReport(localReport)) {
      reportsById.set(report.id, {
        ...report,
        ...localReport,
        remarks: report.remarks ?? localReport.remarks,
      });
      continue;
    }

    reportsById.set(report.id, {
      ...localReport,
      ...report,
      demo: localReport.demo ?? report.demo,
      notes: report.notes || localReport.notes,
    });
  }

  return sortReports(Array.from(reportsById.values()));
}

function isPendingLocalReport(report: ReportRecord) {
  return Boolean(report.syncStatus && report.syncStatus !== "synced");
}

function uploadStatusLabel(status: string) {
  if (status === "synced") return "Up to date";
  if (status === "pending_cloud_sync") return "Waiting to upload";
  return status.replace(/_/g, " ");
}

export function upsertReport(current: ReportRecord[], report: ReportRecord) {
  const next = current.some((item) => item.id === report.id) ? current.map((item) => (item.id === report.id ? report : item)) : [report, ...current];
  return sortReports(next);
}

function sortReports(reports: ReportRecord[]) {
  return [...reports].sort((first, second) => reportTimestamp(second) - reportTimestamp(first));
}

export function findPreviousDemo(reports: ReportRecord[], activeReportId: string | null): DemoBreakdown | null {
  const previousReport = reports.find((report) => report.id !== activeReportId && getDemographicTotals(report.demo ?? emptyDemo()).grandTotal > 0);
  return previousReport?.demo ?? null;
}

function reportTimestamp(report: ReportRecord) {
  const value = report.submittedAt ?? report.auditTrail?.[report.auditTrail.length - 1]?.time ?? report.date;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function periodFromValue(value: string): SystemLogPeriod {
  return value || getCurrentReportingPeriod();
}

export function demoFromPayload(value: unknown): DemoBreakdown {
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

function auditTrailFromPayload(value: unknown): ReportRecord["auditTrail"] | undefined {
  if (!Array.isArray(value)) return undefined;

  const auditTrail = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.time !== "string" || typeof candidate.action !== "string" || typeof candidate.actor !== "string") return null;
      return {
        time: candidate.time,
        action: candidate.action,
        actor: candidate.actor,
      };
    })
    .filter((entry): entry is NonNullable<ReportRecord["auditTrail"]>[number] => entry !== null);

  return auditTrail.length > 0 ? auditTrail : undefined;
}

function isReportStatus(value: string) {
  return ["Submitted", "Resubmitted", "Consolidated", "Returned for Revision", "Draft"].includes(value);
}

function formatAuditTime(value: string, timeFormat: SystemTimeFormat) {
  return formatPhilippineDateTime(value, timeFormat);
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : "";
}

function nonNegativeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}
