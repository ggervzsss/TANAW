import type { DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  deleteLocalReportDraft,
  getMlServiceStatus,
  saveLocalReportDraft,
  type LocalMetricsSummary,
  type LocalReportSubmissionRecord,
} from "../../camera/services/ml-service";
import { prepareDesktopSampleCounts, syncDesktopReportSubmission, type BackendSamplePreparationCounts } from "../../sync/services/cloud-sync";
import type { EnterpriseIntakeReport } from "../services/report-history";
import { getDemographicAllocationStatus, getDemographicTotals } from "../utils/demographics";
import { isSameReportingMonth, reportingMonthKey } from "../utils/reporting-period";
import { sortReportLedgerRows } from "../utils/report-ledger";
import type { ReportLedgerRow } from "../components/ReportLedgerTable";
import { formatPhilippineDateTime, type SystemTimeFormat } from "../../../utils/date-time";

const LEGACY_DEMOGRAPHIC_DRAFT_STORAGE_PREFIX = "tanaw-desktop-report-demographics:";

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

export async function persistDemographicDraft(draftKey: string, period: string, reportId: string | null, demo: DemoBreakdown) {
  try {
    const status = await getMlServiceStatus();
    const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
    if (Object.values(demo).every((value) => value.trim() === "")) {
      await deleteLocalReportDraft(baseUrl, draftKey);
      return;
    }
    await saveLocalReportDraft(baseUrl, draftKey, {
      period,
      reportId,
      reportPayload: { demo, version: 1 },
    });
  } catch {
    // Local draft persistence is best-effort and must not block report editing.
  }
}

export function clearLegacyBrowserDemographicDrafts() {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(LEGACY_DEMOGRAPHIC_DRAFT_STORAGE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Obsolete draft cleanup must not affect the rest of the reports workspace.
  }
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

export async function syncSubmittedReportToCloud(reportId: string) {
  try {
    await syncDesktopReportSubmission(reportId);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The backend could not be reached.";
  }
}

export async function prepareNextWorkspaceMetrics() {
  try {
    const prepared = await prepareDesktopSampleCounts();
    return isPreparedMetrics(prepared) ? prepared : null;
  } catch {
    return null;
  }
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

export function getCurrentReportingPeriod() {
  const now = new Date();
  return reportingPeriodLabel(now);
}

function reportingPeriodLabel(value: Date) {
  const reportingValue = reportingDate(value);
  return `${monthName(reportingValue.monthIndex)} ${reportingValue.year}`;
}

function getReportingPeriodSubmissionError(period: string, now = new Date()) {
  const periodEnd = reportingPeriodEndDate(period);
  if (!periodEnd) {
    return "Reporting period must use the Month YYYY format, for example June 2026.";
  }

  const opensOn = addCalendarDays(periodEnd, 1);
  if (calendarDateKey(reportingDate(now)) >= calendarDateKey(opensOn)) return null;

  return `Submission opens on ${formatCalendarDate(opensOn)} after the ${monthName(periodEnd.monthIndex)} ${periodEnd.year} reporting period closes.`;
}

function reportingPeriodEndDate(value: string): CalendarDate | null {
  const normalizedValue = value.trim();
  const monthYearMatch = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/.exec(normalizedValue);
  if (monthYearMatch) {
    const monthIndex = monthIndexFromLabel(monthYearMatch[1]);
    const year = Number(monthYearMatch[2]);
    if (monthIndex === null || !Number.isInteger(year)) return null;
    return { day: lastDayOfMonth(year, monthIndex), monthIndex, year };
  }

  return null;
}

type CalendarDate = {
  day: number;
  monthIndex: number;
  year: number;
};

function monthIndexFromLabel(monthLabel: string): number | null {
  const monthIndex = MONTH_INDEX_BY_LABEL[monthLabel.slice(0, 3).toLowerCase()];
  return typeof monthIndex === "number" ? monthIndex : null;
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.monthIndex, value.day + days));
  return {
    day: date.getUTCDate(),
    monthIndex: date.getUTCMonth(),
    year: date.getUTCFullYear(),
  };
}

function reportingDate(value: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
  }).formatToParts(value);
  const partValue = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    day: partValue("day"),
    monthIndex: partValue("month") - 1,
    year: partValue("year"),
  };
}

function calendarDateKey(value: CalendarDate) {
  return value.year * 10_000 + (value.monthIndex + 1) * 100 + value.day;
}

function formatCalendarDate(value: CalendarDate) {
  return `${monthName(value.monthIndex, "short")} ${value.day}, ${value.year}`;
}

function monthName(monthIndex: number, format: "short" | "long" = "long") {
  return new Intl.DateTimeFormat("en-US", { month: format, timeZone: "UTC" }).format(new Date(Date.UTC(2026, monthIndex, 1)));
}

const REPORTING_TIME_ZONE = "Asia/Manila";

const MONTH_INDEX_BY_LABEL: Partial<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
