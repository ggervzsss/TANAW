import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DotFormModal } from "./DotFormModal";
import { ReportDraftPanel } from "./ReportDraftPanel";
import { ReportLedgerTable, type ReportLedgerRow } from "./ReportLedgerTable";
import { SubmitReportDialog } from "./SubmitReportDialog";
import { EMPTY_METRICS } from "../../../lib/operationalDefaults";
import type { DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  deleteLocalReportDraft,
  getLocalMetricsSummary,
  getLocalReportDraft,
  getMlServiceStatus,
  listLocalReportSubmissions,
  recordLocalReportSubmission,
  saveLocalReportDraft,
} from "../../camera/services/ml-service";
import type { LocalMetricsSummary, LocalReportSubmission, LocalReportSubmissionRecord } from "../../camera/services/ml-service";
import { listEnterpriseReportHistory, type EnterpriseIntakeReport } from "../services/report-history";
import { DESKTOP_REPORT_SYNC_EVENT, getDesktopSamplePreparation, prepareDesktopSampleCounts, syncDesktopReportSubmission, type BackendSamplePreparationCounts } from "../../sync/services/cloud-sync";
import { downloadDotReportPdf } from "../utils/pdf";
import { getDemographicAllocationStatus, getDemographicTotals } from "../utils/demographics";
import { formatReportingPeriodLabel, isSameReportingMonth, reportingMonthKey, shouldPrepareDraftPeriod } from "../utils/reporting-period";
import { notifyError } from "../../toasts/services/toast-service";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { formatPhilippineDateTime, type SystemTimeFormat } from "../../../utils/date-time";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";

type ReportsViewProps = {
  enterpriseName: string;
  reportsHistory: ReportRecord[];
  setReportsHistory: React.Dispatch<React.SetStateAction<ReportRecord[]>>;
};

type DotPreviewState = {
  demo: DemoBreakdown;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  reportId: string;
};

const LEGACY_DEMOGRAPHIC_DRAFT_STORAGE_PREFIX = "tanaw-desktop-report-demographics:";
const DEMOGRAPHIC_DRAFT_RETRY_DELAY_MS = 2000;
const DEMOGRAPHIC_DRAFT_SAVE_DELAY_MS = 300;

export function ReportsView({ enterpriseName, reportsHistory, setReportsHistory }: ReportsViewProps) {
  const { timeFormat } = useSystemDisplayPreferences();
  const currentReportingPeriod = useMemo(() => getCurrentReportingPeriod(), []);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [livePeriod, setLivePeriod] = useState<SystemLogPeriod>(currentReportingPeriod);
  const [period, setPeriod] = useState<SystemLogPeriod>(currentReportingPeriod);
  const [notes, setNotes] = useState("");
  const [demo, setDemo] = useState<DemoBreakdown>(emptyDemo);

  const [previewReport, setPreviewReport] = useState<DotPreviewState | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPeriodChanging, setIsPeriodChanging] = useState(false);
  const [pendingPeriodCounts, setPendingPeriodCounts] = useState<BackendSamplePreparationCounts[]>([]);
  const reportsHistoryRef = useRef(reportsHistory);

  usePersistentIssue({
    id: "reports-local-metrics",
    message: metricsError,
    title: "Local metrics unavailable",
    tone: "error",
  });
  usePersistentIssue({
    id: "reports-submissions",
    message: ledgerError,
    title: "Report submissions unavailable",
    tone: "warning",
  });

  const activeReport = activeReportId ? (reportsHistory.find((r) => r.id === activeReportId) ?? null) : null;
  const isReadOnly = activeReport ? !["Draft", "Returned for Revision"].includes(activeReport.status) : false;
  const demographicDraftKey = useMemo(() => getDemographicDraftKey(activeReportId, period), [activeReportId, period]);
  const [hydratedDemographicDraftKey, setHydratedDemographicDraftKey] = useState<string | null>(null);

  const selectedPeriodCounts = pendingPeriodCounts.find((counts) => isSameReportingMonth(counts.period, period)) ?? null;
  const displayedMetrics = activeReport
    ? metricsFromReport(activeReport)
    : isSameReportingMonth(period, livePeriod)
      ? liveMetrics
      : selectedPeriodCounts
        ? metricsFromPendingCounts(selectedPeriodCounts)
        : liveMetrics;
  const currentPeriodCounts = pendingPeriodCounts.find((counts) => isSameReportingMonth(counts.period, currentReportingPeriod)) ?? null;
  const currentLedgerMetrics = isSameReportingMonth(livePeriod, currentReportingPeriod) ? liveMetrics : currentPeriodCounts ? metricsFromPendingCounts(currentPeriodCounts) : EMPTY_METRICS;
  const currentLedgerDemo = !activeReport && isSameReportingMonth(period, currentReportingPeriod) ? demo : emptyDemo();
  const currentLedgerNotes = !activeReport && isSameReportingMonth(period, currentReportingPeriod) ? notes : "";

  const blockingMetricsError = activeReport ? null : metricsError;
  const validationError = validateReportDraft(displayedMetrics, demo, period, reportsHistory, activeReportId, {
    checkDuplicatePeriod: !(activeReport && isReadOnly),
    checkReportingPeriod: !isReadOnly,
  });
  const activeLedgerKey = activeReport ? historyLedgerKey(activeReport.id) : draftLedgerKey(period);
  const ledgerRows = useMemo(
    () =>
      buildLedgerRows({
        currentDemo: currentLedgerDemo,
        currentMetrics: currentLedgerMetrics,
        currentNotes: currentLedgerNotes,
        currentPeriod: currentReportingPeriod,
        pendingCounts: pendingPeriodCounts,
        reportsHistory,
      }),
    [currentLedgerDemo, currentLedgerMetrics, currentLedgerNotes, currentReportingPeriod, pendingPeriodCounts, reportsHistory],
  );
  const previousDemo = useMemo(() => findPreviousDemo(reportsHistory, activeReportId), [activeReportId, reportsHistory]);

  useEffect(() => {
    reportsHistoryRef.current = reportsHistory;
  }, [reportsHistory]);

  const refreshLocalMetrics = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const summary = await getLocalMetricsSummary(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
      const summaryPeriod = summary.period || currentReportingPeriod;
      setLiveMetrics(metricsFromSummary(summary));
      setLivePeriod(summaryPeriod);
      if (!activeReportId) {
        setPeriod((currentPeriod) => (isSameReportingMonth(currentPeriod, summaryPeriod) ? summaryPeriod : currentPeriod));
      }
      setMetricsError(null);
    } catch (error) {
      setMetricsError(error instanceof Error ? error.message : "Unable to load local edge metrics.");
    }
  }, [activeReportId, currentReportingPeriod]);

  const refreshLocalReports = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const submissions = await listLocalReportSubmissions(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
      let cloudHistory: Awaited<ReturnType<typeof listEnterpriseReportHistory>> = [];
      try {
        cloudHistory = await listEnterpriseReportHistory();
      } catch {
        // Reports saved on this device remain available while the backend is offline.
      }
      const localReports = submissions.map((submission) => reportFromLocalSubmission(submission, timeFormat));
      const cloudReports = cloudHistory.map((report) => reportFromCloudSubmission(report, timeFormat));
      setReportsHistory(mergeReportHistory(localReports, cloudReports));
      setLedgerError(null);
    } catch (error) {
      setLedgerError(error instanceof Error ? error.message : "Unable to load reports saved on this device.");
    }
  }, [setReportsHistory, timeFormat]);

  const refreshPendingPeriods = useCallback(async () => {
    try {
      const preparation = await getDesktopSamplePreparation();
      const pendingCounts = preparation ? (preparation.pendingCounts?.length ? preparation.pendingCounts : preparation.counts ? [preparation.counts] : []) : [];
      setPendingPeriodCounts(pendingCounts);
    } catch {
      setPendingPeriodCounts([]);
    }
  }, []);

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

  useEffect(() => {
    void refreshPendingPeriods();
    const intervalId = window.setInterval(() => void refreshPendingPeriods(), 15000);
    return () => window.clearInterval(intervalId);
  }, [refreshPendingPeriods]);

  useEffect(() => {
    clearLegacyBrowserDemographicDrafts();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimeoutId: number | null = null;
    setHydratedDemographicDraftKey(null);

    const hydrateDraft = async () => {
      let storedDemo: DemoBreakdown | null = null;
      if (!isReadOnly) {
        try {
          const status = await getMlServiceStatus();
          const draft = await getLocalReportDraft(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, demographicDraftKey);
          storedDemo = draft ? demoFromPayload(draft.payload.demo) : null;
        } catch {
          if (!cancelled) {
            retryTimeoutId = window.setTimeout(() => void hydrateDraft(), DEMOGRAPHIC_DRAFT_RETRY_DELAY_MS);
          }
          return;
        }
      }
      if (cancelled) return;

      if (storedDemo) {
        setDemo(storedDemo);
      } else if (activeReportId) {
        const report = reportsHistoryRef.current.find((item) => item.id === activeReportId);
        setDemo(report?.demo ?? emptyDemo());
      } else {
        setDemo(emptyDemo());
      }
      setHydratedDemographicDraftKey(demographicDraftKey);
    };

    void hydrateDraft();
    return () => {
      cancelled = true;
      if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
    };
  }, [activeReportId, demographicDraftKey, isReadOnly]);

  useEffect(() => {
    if (isReadOnly || hydratedDemographicDraftKey !== demographicDraftKey) return;

    const timeoutId = window.setTimeout(() => {
      void persistDemographicDraft(demographicDraftKey, period, activeReportId, demo);
    }, DEMOGRAPHIC_DRAFT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [activeReportId, demo, demographicDraftKey, hydratedDemographicDraftKey, isReadOnly, period]);

  const resetDraftWorkspace = (nextPeriod?: string) => {
    setActiveReportId(null);
    setPeriod(nextPeriod ?? currentReportingPeriod);
    setNotes("");
    setDemo(emptyDemo());
    setPreviewReport(null);
  };

  const handleDraftPeriodSelect = async (nextPeriod: string) => {
    if (isSameReportingMonth(nextPeriod, currentReportingPeriod)) {
      if (pendingPeriodCounts.some((counts) => isSameReportingMonth(counts.period, nextPeriod))) {
        setMetricsError(null);
      }
      if (!activeReportId && isSameReportingMonth(nextPeriod, period)) return;
      resetDraftWorkspace(currentReportingPeriod);
      return;
    }

    const requiresPreparation = shouldPrepareDraftPeriod(nextPeriod, currentReportingPeriod, livePeriod, pendingPeriodCounts);
    if (!activeReportId && isSameReportingMonth(nextPeriod, period) && !requiresPreparation) return;

    if (!requiresPreparation) {
      if (isSameReportingMonth(nextPeriod, livePeriod)) {
        setMetricsError(null);
      }
      resetDraftWorkspace(nextPeriod);
      return;
    }

    setIsPeriodChanging(true);
    try {
      const prepared = await prepareDesktopSampleCounts(nextPeriod);
      if (!isPreparedMetrics(prepared) || (prepared.prepared === false && prepared.period !== nextPeriod)) {
        throw new Error(`No prepared count package is available for ${nextPeriod}.`);
      }
      setActiveReportId(null);
      setLiveMetrics(metricsFromSummary(prepared));
      setLivePeriod(prepared.period || nextPeriod);
      setPeriod(prepared.period || nextPeriod);
      setNotes("");
      setDemo(emptyDemo());
      setPreviewReport(null);
      setMetricsError(null);
      void refreshPendingPeriods();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load the selected reporting period.";
      setMetricsError(message);
      notifyError(message);
    } finally {
      setIsPeriodChanging(false);
    }
  };

  const handleViewReport = (report: ReportRecord) => {
    setActiveReportId(report.id);
    setPeriod(report.period || report.date || getCurrentReportingPeriod());
    setNotes(report.notes || "");
    setDemo(report.demo || emptyDemo());
  };

  const handleSelectLedgerRow = (row: ReportLedgerRow) => {
    if (row.kind === "history") {
      handleViewReport(row.report);
      return;
    }

    void handleDraftPeriodSelect(row.report.period ?? row.report.date);
  };

  const handlePreviewReport = (report: ReportRecord) => {
    setPreviewReport({
      demo: report.demo ?? emptyDemo(),
      metrics: metricsFromReport(report),
      notes: report.notes ?? "",
      period: report.period ?? report.date,
      reportId: report.id,
    });
  };

  const handleDownloadReport = (report: ReportRecord) => {
    const reportDemo = report.demo ?? emptyDemo();
    const reportMetrics = metricsFromReport(report);
    const exportError = validateDemographicAllocation(reportMetrics, reportDemo);
    if (exportError) {
      notifyError(exportError);
      handlePreviewReport(report);
      return;
    }

    downloadDotReportPdf({
      enterpriseName,
      reportId: report.id,
      period: formatReportingPeriodLabel(report.period ?? report.date),
      metrics: reportMetrics,
      demo: reportDemo,
      notes: report.notes ?? "",
    });
  };

  const executeSubmit = async () => {
    setIsSubmitting(true);
    const submitValidationError = validateReportDraft(displayedMetrics, demo, period, reportsHistory, activeReportId, {
      checkDuplicatePeriod: true,
      checkReportingPeriod: true,
    });
    if (submitValidationError) {
      notifyError(submitValidationError);
      setIsSubmitting(false);
      return;
    }

    const auditTime = formatPhilippineDateTime(new Date(), timeFormat);

    const reportId = activeReportId ?? `REP-${new Date().getTime().toString().slice(-6)}`;
    const reportMetrics = displayedMetrics;
    const nextStatus = activeReportId ? "Resubmitted" : "Submitted";
    const nextAuditTrail = activeReportId
      ? [
          ...(activeReport?.auditTrail || []),
          {
            time: auditTime,
            action: "Report Resubmitted",
            actor: "Enterprise User",
          },
        ]
      : [
          {
            time: auditTime,
            action: "Report Prepared",
            actor: "Enterprise User",
          },
          {
            time: auditTime,
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
    let mlServiceBaseUrl = DEFAULT_ML_SERVICE_BASE_URL;
    try {
      const status = await getMlServiceStatus();
      mlServiceBaseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
      submission = await recordLocalReportSubmission(mlServiceBaseUrl, {
        metrics: {
          entries: reportMetrics.entries,
          exits: reportMetrics.exits,
          peakOccupancy: reportMetrics.peak,
          uniqueCount: reportMetrics.unique,
        },
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
    const cloudSyncError = await syncSubmittedReportToCloud(reportId);
    const submittedSyncStatus = cloudSyncError ? submission.sync_status : "synced";
    const restoredWorkspaceMetrics = !cloudSyncError && !activeReportId ? await prepareNextWorkspaceMetrics() : null;

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
              syncStatus: submittedSyncStatus,
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
        syncStatus: submittedSyncStatus,
        auditTrail: nextAuditTrail,
        remarks: null,
      };
      setReportsHistory((prev) => upsertReport(prev, newReport));
    }
    setPendingPeriodCounts((prev) => prev.filter((counts) => counts.period !== period));
    try {
      await deleteLocalReportDraft(mlServiceBaseUrl, demographicDraftKey);
    } catch {
      // The submitted report is already durable; stale draft cleanup remains best-effort.
    }
    setShowConfirm(false);
    setIsSubmitting(false);
    if (restoredWorkspaceMetrics) {
      setLiveMetrics(metricsFromSummary(restoredWorkspaceMetrics));
      setLivePeriod(restoredWorkspaceMetrics.period || currentReportingPeriod);
    } else {
      void refreshLocalMetrics();
    }
    void refreshLocalReports();
    void refreshPendingPeriods();
    if (cloudSyncError) {
      notifyError(`Report saved on this device, but it is still waiting to upload: ${cloudSyncError}`);
      window.dispatchEvent(new Event(DESKTOP_REPORT_SYNC_EVENT));
    }
    resetDraftWorkspace();
  };

  return (
    <div className="animate-in fade-in space-y-6 font-['Inter'] duration-500">
      {previewReport && (
        <DotFormModal
          demo={previewReport.demo}
          enterpriseName={enterpriseName}
          metrics={previewReport.metrics}
          notes={previewReport.notes}
          period={previewReport.period}
          reportId={previewReport.reportId}
          validationMessage={validateDemographicAllocation(previewReport.metrics, previewReport.demo)}
          onClose={() => setPreviewReport(null)}
        />
      )}

      {showConfirm && <SubmitReportDialog isSubmitting={isSubmitting} onCancel={() => setShowConfirm(false)} onConfirm={executeSubmit} />}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#111827]">Reports</h2>
          <p className="mt-1 text-sm text-gray-500">Prepare unfinished monthly reports and review submitted report history.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ReportDraftPanel
          activeReport={activeReport}
          activeReportId={activeReportId}
          demo={demo}
          isReadOnly={isReadOnly}
          isPeriodChanging={isPeriodChanging}
          metrics={displayedMetrics}
          metricsError={blockingMetricsError}
          notes={notes}
          period={period}
          previousDemo={previousDemo}
          validationError={validationError}
          onSubmitPrompt={() => setShowConfirm(true)}
          setDemo={setDemo}
          setNotes={setNotes}
        />

        <ReportLedgerTable
          activeLedgerKey={activeLedgerKey}
          ledgerRows={ledgerRows}
          onDownloadReport={handleDownloadReport}
          onPreviewReport={handlePreviewReport}
          onSelectReport={handleSelectLedgerRow}
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

function validateDemographicAllocation(metrics: Metrics, demo: DemoBreakdown) {
  return getDemographicAllocationStatus(demo, metrics.unique).validationMessage;
}

function metricsFromReport(report: ReportRecord): Metrics {
  return {
    entries: report.entries,
    exits: report.exits ?? 0,
    peak: report.peak ?? Math.max(0, report.entries - (report.exits ?? 0)),
    unique: report.unique,
  };
}

function metricsFromSummary(summary: LocalMetricsSummary): Metrics {
  return {
    entries: summary.entries,
    exits: summary.exits,
    peak: summary.peak_occupancy,
    unique: summary.unique_count,
  };
}

function metricsFromPendingCounts(counts: BackendSamplePreparationCounts): Metrics {
  return {
    entries: counts.entries,
    exits: counts.exits,
    peak: counts.peakOccupancy,
    unique: counts.uniqueCount,
  };
}

function isPreparedMetrics(value: unknown): value is LocalMetricsSummary & { prepared: boolean } {
  return Boolean(value && typeof value === "object" && "entries" in value && "period" in value);
}

function getDemographicDraftKey(activeReportId: string | null, period: string) {
  return activeReportId ? `report:${activeReportId}` : `period:${period || getCurrentReportingPeriod()}`;
}

async function persistDemographicDraft(draftKey: string, period: string, reportId: string | null, demo: DemoBreakdown) {
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

function clearLegacyBrowserDemographicDrafts() {
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

function buildLedgerRows({
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

  return rows;
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

function draftLedgerKey(period: string) {
  return `draft:${reportingMonthKey(period)}`;
}

function historyLedgerKey(reportId: string) {
  return `history:${reportId}`;
}

function reportFromLocalSubmission(submission: LocalReportSubmissionRecord, timeFormat: SystemTimeFormat): ReportRecord {
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

function reportFromCloudSubmission(report: EnterpriseIntakeReport, timeFormat: SystemTimeFormat): ReportRecord {
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

async function syncSubmittedReportToCloud(reportId: string) {
  try {
    await syncDesktopReportSubmission(reportId);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The backend could not be reached.";
  }
}

async function prepareNextWorkspaceMetrics() {
  try {
    const prepared = await prepareDesktopSampleCounts();
    return isPreparedMetrics(prepared) ? prepared : null;
  } catch {
    return null;
  }
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

function upsertReport(current: ReportRecord[], report: ReportRecord) {
  const next = current.some((item) => item.id === report.id) ? current.map((item) => (item.id === report.id ? report : item)) : [report, ...current];
  return sortReports(next);
}

function sortReports(reports: ReportRecord[]) {
  return [...reports].sort((first, second) => reportTimestamp(second) - reportTimestamp(first));
}

function findPreviousDemo(reports: ReportRecord[], activeReportId: string | null): DemoBreakdown | null {
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

function formatAuditTime(value: string, timeFormat: SystemTimeFormat) {
  return formatPhilippineDateTime(value, timeFormat);
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
  return typeof value === "string" ? value : typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : "";
}

function nonNegativeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function getCurrentReportingPeriod() {
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
