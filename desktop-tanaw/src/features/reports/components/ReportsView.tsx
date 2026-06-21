import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { DotFormModal } from "./DotFormModal";
import { ReportDraftPanel } from "./ReportDraftPanel";
import { ReportLedgerTable } from "./ReportLedgerTable";
import { SubmitReportDialog } from "./SubmitReportDialog";
import { EMPTY_METRICS, REPORTING_PERIODS } from "../../../lib/operationalDefaults";
import type { DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, getLocalMetricsSummary, getMlServiceStatus, listLocalReportSubmissions, recordLocalReportSubmission } from "../../camera/services/ml-service";
import type { LocalReportSubmission, LocalReportSubmissionRecord } from "../../camera/services/ml-service";
import { listEnterpriseReportHistory, type EnterpriseIntakeReport } from "../services/report-history";
import { DESKTOP_REPORT_SYNC_EVENT } from "../../sync/services/cloud-sync";
import { downloadDotReportPdf } from "../utils/pdf";

type ReportsViewProps = {
  reportsHistory: ReportRecord[];
  setReportsHistory: React.Dispatch<React.SetStateAction<ReportRecord[]>>;
};

export function ReportsView({ reportsHistory, setReportsHistory }: ReportsViewProps) {
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [period, setPeriod] = useState<SystemLogPeriod>("Current Period");
  const [notes, setNotes] = useState("");
  const [demo, setDemo] = useState<DemoBreakdown>(emptyDemo);

  const [showPreview, setShowPreview] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeReport = activeReportId ? (reportsHistory.find((r) => r.id === activeReportId) ?? null) : null;
  const isReadOnly = activeReport ? !["Draft", "Returned for Revision"].includes(activeReport.status) : false;

  const periodKeys: string[] = [...REPORTING_PERIODS];
  const currIndex = periodKeys.indexOf(period);
  const prevPeriod = currIndex >= 0 && currIndex < periodKeys.length - 1 ? periodKeys[currIndex + 1] : null;
  const prevMetrics = prevPeriod ? EMPTY_METRICS : null;
  const displayedMetrics = activeReport ? metricsFromReport(activeReport) : liveMetrics;
  const uniqueTrend = prevMetrics && prevMetrics.unique > 0 ? Math.round(((displayedMetrics.unique - prevMetrics.unique) / prevMetrics.unique) * 100) : 0;

  const isError = displayedMetrics.peak > displayedMetrics.entries;
  const blockingMetricsError = activeReport ? null : metricsError;
  const validationError = activeReport && isReadOnly ? null : validateReportDraft(displayedMetrics, demo, period, reportsHistory, activeReportId);

  const refreshLocalMetrics = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const summary = await getLocalMetricsSummary(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
      setLiveMetrics({
        entries: summary.entries,
        exits: summary.exits,
        peak: summary.peak_occupancy,
        unique: summary.unique_count,
      });
      setMetricsError(null);
    } catch (error) {
      setMetricsError(error instanceof Error ? error.message : "Unable to load local edge metrics.");
    }
  }, []);

  const refreshLocalReports = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const [submissions, cloudHistory] = await Promise.all([
        listLocalReportSubmissions(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL),
        listEnterpriseReportHistory(),
      ]);
      const localReports = submissions.map(reportFromLocalSubmission);
      const cloudReports = cloudHistory.map(reportFromCloudSubmission);
      setReportsHistory(mergeReportHistory(localReports, cloudReports));
      setLedgerError(null);
    } catch (error) {
      setLedgerError(error instanceof Error ? error.message : "Unable to load local report ledger.");
    }
  }, [setReportsHistory]);

  useEffect(() => {
    void refreshLocalMetrics();
    const intervalId = window.setInterval(() => void refreshLocalMetrics(), 5000);
    return () => window.clearInterval(intervalId);
  }, [refreshLocalMetrics]);

  useEffect(() => {
    void refreshLocalReports();
    const intervalId = window.setInterval(() => void refreshLocalReports(), 15000);
    return () => window.clearInterval(intervalId);
  }, [refreshLocalReports]);

  const handleGenerateNew = () => {
    setActiveReportId(null);
    setPeriod("Current Period");
    setNotes("");
    setDemo(emptyDemo());
  };

  const handleViewReport = (report: ReportRecord) => {
    setActiveReportId(report.id);
    setPeriod(report.period || "Current Period");
    setNotes(report.notes || "");
    setDemo(report.demo || emptyDemo());
  };

  const executeSubmit = async () => {
    setIsSubmitting(true);
    const now = new Date().toLocaleString("en-US", {
      hour12: true,
      hour: "numeric",
      minute: "2-digit",
    });
    const todayDate = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });

    const reportId = activeReportId ?? `REP-${new Date().getTime().toString().slice(-6)}`;
    const reportMetrics = displayedMetrics;
    const nextStatus = activeReportId ? "Resubmitted" : "Submitted";
    const nextAuditTrail = activeReportId
      ? [
          ...(activeReport?.auditTrail || []),
          {
            time: `${todayDate} ${now}`,
            action: "Report Resubmitted",
            actor: "Enterprise User",
          },
        ]
      : [
          {
            time: `${todayDate} ${now}`,
            action: "Draft Created",
            actor: "Enterprise User",
          },
          {
            time: `${todayDate} ${now}`,
            action: "Report Submitted",
            actor: "Enterprise User",
          },
        ];
    const reportPayload = {
      auditTrail: nextAuditTrail,
      demo,
      metrics: reportMetrics,
      notes,
      period,
      status: nextStatus,
    };

    let submission: LocalReportSubmission;
    try {
      const status = await getMlServiceStatus();
      submission = await recordLocalReportSubmission(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, {
        notes,
        period,
        reportId,
        reportPayload,
      });
    } catch (error) {
      setMetricsError(error instanceof Error ? error.message : "Unable to save report submission locally.");
      setIsSubmitting(false);
      return;
    }

    const submittedMetrics: Metrics = {
      entries: submission.entries,
      exits: submission.exits,
      peak: submission.peak_occupancy,
      unique: submission.unique_count,
    };

    if (activeReportId) {
      setReportsHistory((prev) =>
        prev.map((r) => {
          if (r.id === activeReportId) {
            return {
              ...r,
              status: nextStatus,
              entries: submittedMetrics.entries,
              exits: submittedMetrics.exits,
              peak: submittedMetrics.peak,
              unique: submittedMetrics.unique,
              period,
              demo,
              notes,
              submittedAt: submission.submitted_at,
              syncStatus: submission.sync_status,
              remarks: null,
              auditTrail: nextAuditTrail,
            };
          }
          return r;
        }),
      );
    } else {
      const newReport: ReportRecord = {
        id: reportId,
        date: period,
        status: nextStatus,
        entries: submittedMetrics.entries,
        exits: submittedMetrics.exits,
        peak: submittedMetrics.peak,
        unique: submittedMetrics.unique,
        period,
        demo,
        notes,
        submittedAt: submission.submitted_at,
        syncStatus: submission.sync_status,
        auditTrail: nextAuditTrail,
        remarks: null,
      };
      setReportsHistory((prev) => upsertReport(prev, newReport));
    }
    setShowConfirm(false);
    setIsSubmitting(false);
    void refreshLocalMetrics();
    void refreshLocalReports();
    window.dispatchEvent(new Event(DESKTOP_REPORT_SYNC_EVENT));
    handleGenerateNew();
  };

  return (
    <div className="animate-in fade-in space-y-6 font-['Inter'] duration-500">
      {showPreview && <DotFormModal onClose={() => setShowPreview(false)} period={period} metrics={displayedMetrics} demo={demo} notes={notes} reportId={activeReportId ?? "TANAW-DRAFT"} />}

      {showConfirm && <SubmitReportDialog isSubmitting={isSubmitting} onCancel={() => setShowConfirm(false)} onConfirm={executeSubmit} />}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#111827]">Report Generation & Submission</h2>
          <p className="mt-1 text-sm text-gray-500">Generate LGU-required DOT reports using system-verified metrics.</p>
          {metricsError && <p className="mt-1 text-xs font-semibold text-red-600">Local metrics unavailable: {metricsError}</p>}
          {ledgerError && <p className="mt-1 text-xs font-semibold text-red-600">Report ledger unavailable: {ledgerError}</p>}
        </div>
        <button
          onClick={handleGenerateNew}
          className="flex items-center gap-2 rounded-sm border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-[#111827] shadow-sm transition-colors hover:bg-gray-50"
        >
          <Plus size={16} /> New Draft
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ReportDraftPanel
          activeReport={activeReport}
          activeReportId={activeReportId}
          demo={demo}
          isError={isError}
          isReadOnly={isReadOnly}
          metrics={displayedMetrics}
          metricsError={blockingMetricsError}
          notes={notes}
          period={period}
          prevMetrics={prevMetrics}
          uniqueTrend={uniqueTrend}
          validationError={validationError}
          onPreview={() => setShowPreview(true)}
          onSubmitPrompt={() => setShowConfirm(true)}
          setDemo={setDemo}
          setNotes={setNotes}
          setPeriod={setPeriod}
        />

        <ReportLedgerTable
          activeReportId={activeReportId}
          reportsHistory={reportsHistory}
          onViewReport={handleViewReport}
          onPrintReport={(report) => {
            downloadDotReportPdf({
              reportId: report.id,
              period: report.period ?? report.date,
              metrics: metricsFromReport(report),
              demo: report.demo ?? emptyDemo(),
              notes: report.notes ?? "",
            });
          }}
        />
      </div>
    </div>
  );
}

function validateReportDraft(
  metrics: Metrics,
  demo: DemoBreakdown,
  period: string,
  reports: ReportRecord[],
  activeReportId: string | null,
) {
  if (metrics.entries <= 0) return "No local visitor metrics are available for submission.";
  if (metrics.exits > metrics.entries) return "Total exits cannot exceed total entries.";
  if (metrics.peak > metrics.entries) return "Peak occupancy cannot exceed total entries.";
  if (metrics.unique > metrics.entries) return "Estimated unique count cannot exceed total entries.";
  const values = Object.values(demo);
  if (values.some((value) => value.trim() === "")) return "Complete every demographics field.";
  if (values.some((value) => !/^\d+$/.test(value.trim()))) return "Demographics values must be non-negative whole numbers.";
  if (reports.some((report) => report.id !== activeReportId && report.period === period && report.status !== "Draft")) {
    return `A report for ${period} has already been submitted.`;
  }
  return null;
}

function metricsFromReport(report: ReportRecord): Metrics {
  return {
    entries: report.entries,
    exits: report.exits ?? 0,
    peak: report.peak ?? Math.max(0, report.entries - (report.exits ?? 0)),
    unique: report.unique,
  };
}

function reportFromLocalSubmission(submission: LocalReportSubmissionRecord): ReportRecord {
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
    auditTrail: auditTrailFromPayload(payload.auditTrail) ?? [
      {
        time: formatAuditTime(submission.submitted_at),
        action: payloadStatus === "Resubmitted" ? "Report Resubmitted" : "Report Submitted",
        actor: "Enterprise User",
      },
    ],
    remarks: null,
    submittedAt: submission.submitted_at,
    syncStatus: submission.sync_status,
  };
}

function reportFromCloudSubmission(report: EnterpriseIntakeReport): ReportRecord {
  const peak = typeof report.metrics.peak === "number" ? report.metrics.peak : Number(report.metrics.peak) || 0;
  const status = report.status === "Returned" ? "Returned for Revision" : report.status === "Consolidated" ? "Consolidated" : "Submitted";
  return {
    id: report.code,
    date: report.period,
    status,
    entries: report.metrics.entry,
    exits: report.metrics.exit,
    peak,
    unique: report.metrics.unique,
    period: report.period,
    notes: report.notes ?? "",
    remarks: report.remarks,
    submittedAt: report.submittedAt,
    syncStatus: "synced",
    auditTrail: [
      {
        time: formatAuditTime(report.submittedAt),
        action: status === "Consolidated" ? "Report Consolidated" : status === "Returned for Revision" ? "Report Returned" : "Report Submitted",
        actor: status === "Submitted" ? "Enterprise User" : "LGU Staff",
      },
    ],
  };
}

function mergeReportHistory(localReports: ReportRecord[], cloudReports: ReportRecord[]) {
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

    reportsById.set(report.id, {
      ...localReport,
      ...report,
      demo: localReport.demo ?? report.demo,
      notes: report.notes || localReport.notes,
    });
  }

  return sortReports(Array.from(reportsById.values()));
}

function upsertReport(current: ReportRecord[], report: ReportRecord) {
  const next = current.some((item) => item.id === report.id) ? current.map((item) => (item.id === report.id ? report : item)) : [report, ...current];
  return sortReports(next);
}

function sortReports(reports: ReportRecord[]) {
  return [...reports].sort((first, second) => reportTimestamp(second) - reportTimestamp(first));
}

function reportTimestamp(report: ReportRecord) {
  const value = report.submittedAt ?? report.auditTrail?.[report.auditTrail.length - 1]?.time ?? report.date;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function periodFromValue(value: string): SystemLogPeriod {
  return value || "Current Period";
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

function formatAuditTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    hour12: true,
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function emptyDemo(): DemoBreakdown {
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
  return typeof value === "string" ? value : "";
}
