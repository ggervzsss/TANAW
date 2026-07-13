import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DotFormModal } from "./DotFormModal";
import { ReportDraftPanel } from "./ReportDraftPanel";
import { ReportLedgerTable, type ReportLedgerRow } from "./ReportLedgerTable";
import { SubmitReportDialog } from "./SubmitReportDialog";
import { EMPTY_METRICS } from "../../../lib/operationalDefaults";
import type { CanonicalReportingPeriod, DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, getLocalMetricsSummary, getMlServiceStatus, listLocalReportSubmissions, recordLocalReportSubmission } from "../../camera/services/ml-service";
import type { LocalMetricsSummary, LocalReportSubmission, LocalReportSubmissionRecord } from "../../camera/services/ml-service";
import { listEnterpriseReportHistory, type EnterpriseIntakeReport } from "../services/report-history";
import {
  DESKTOP_REPORT_SYNC_EVENT,
  getDesktopMockPreparation,
  prepareDesktopMockCounts,
  reportingPeriodForPreparationCounts,
  syncDesktopReportSubmission,
  type BackendMockPreparationCounts,
} from "../../sync/services/cloud-sync";
import { downloadDotReportPdf } from "../utils/pdf";
import { getDemographicAllocationStatus, getDemographicTotals } from "../utils/demographics";
import { notifyError } from "../../toasts/services/toast-service";
import {
  canonicalReportingPeriodFromSource,
  getReportingPeriodSubmissionError,
  UNCLASSIFIED_REPORTING_PERIOD_LABEL,
} from "../services/reporting-period";

type ReportsViewProps = {
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

const DEMOGRAPHIC_DRAFT_STORAGE_PREFIX = "tanaw-desktop-report-demographics";

export function ReportsView({ reportsHistory, setReportsHistory }: ReportsViewProps) {
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [liveReportingPeriod, setLiveReportingPeriod] = useState<CanonicalReportingPeriod | null>(null);
  const [reportingPeriod, setReportingPeriod] = useState<CanonicalReportingPeriod | null>(null);
  const [notes, setNotes] = useState("");
  const [demo, setDemo] = useState<DemoBreakdown>(emptyDemo);

  const [previewReport, setPreviewReport] = useState<DotPreviewState | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPeriodChanging, setIsPeriodChanging] = useState(false);
  const [pendingPeriodCounts, setPendingPeriodCounts] = useState<BackendMockPreparationCounts[]>([]);
  const reportsHistoryRef = useRef(reportsHistory);

  const activeReport = activeReportId ? (reportsHistory.find((r) => r.id === activeReportId) ?? null) : null;
  const isReadOnly = activeReport ? !["Draft", "Returned for Revision"].includes(activeReport.status) : false;
  const period = reportingPeriod?.label ?? UNCLASSIFIED_REPORTING_PERIOD_LABEL;
  const demographicDraftStorageKey = useMemo(
    () => getDemographicDraftStorageKey(activeReportId, reportingPeriod),
    [activeReportId, reportingPeriod],
  );
  const [hydratedDemographicDraftKey, setHydratedDemographicDraftKey] = useState<string | null>(null);

  const selectedPeriodCounts =
    pendingPeriodCounts.find(
      (counts) => reportingPeriodForPreparationCounts(counts).periodId === reportingPeriod?.periodId,
    ) ?? null;
  const displayedMetrics = activeReport
    ? metricsFromReport(activeReport)
    : reportingPeriod?.periodId === liveReportingPeriod?.periodId
      ? liveMetrics
      : selectedPeriodCounts
        ? metricsFromPendingCounts(selectedPeriodCounts)
        : liveMetrics;
  const currentLedgerMetrics = liveReportingPeriod ? liveMetrics : EMPTY_METRICS;
  const currentLedgerDemo =
    !activeReport && reportingPeriod?.periodId === liveReportingPeriod?.periodId
      ? demo
      : loadStoredDemographicDraft(getDemographicDraftStorageKey(null, liveReportingPeriod)) ?? emptyDemo();
  const currentLedgerNotes = !activeReport && reportingPeriod?.periodId === liveReportingPeriod?.periodId ? notes : "";

  const blockingMetricsError = activeReport ? null : metricsError;
  const validationError = validateReportDraft(displayedMetrics, demo, reportingPeriod, reportsHistory, activeReportId, {
    checkDuplicatePeriod: !(activeReport && isReadOnly),
    checkReportingPeriod: !isReadOnly,
  });
  const activeLedgerKey = activeReport ? historyLedgerKey(activeReport.id) : draftLedgerKey(reportingPeriod);
  const ledgerRows = useMemo(
    () =>
      buildLedgerRows({
        currentDemo: currentLedgerDemo,
        currentMetrics: currentLedgerMetrics,
        currentNotes: currentLedgerNotes,
        currentPeriod: liveReportingPeriod,
        pendingCounts: pendingPeriodCounts,
        reportsHistory,
      }),
    [currentLedgerDemo, currentLedgerMetrics, currentLedgerNotes, liveReportingPeriod, pendingPeriodCounts, reportsHistory],
  );
  const previousDemo = useMemo(() => findPreviousDemo(reportsHistory, activeReportId), [activeReportId, reportsHistory]);

  useEffect(() => {
    reportsHistoryRef.current = reportsHistory;
  }, [reportsHistory]);

  const refreshLocalMetrics = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const summary = await getLocalMetricsSummary(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
      const summaryPeriod = canonicalReportingPeriodFromSource(summary);
      setLiveMetrics(metricsFromSummary(summary));
      setLiveReportingPeriod(summaryPeriod);
      if (!activeReportId) {
        setReportingPeriod(summaryPeriod);
      }
      setMetricsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load local edge metrics.";
      setLiveMetrics(EMPTY_METRICS);
      setLiveReportingPeriod(null);
      if (!activeReportId) setReportingPeriod(null);
      setMetricsError(message);
    }
  }, [activeReportId]);

  const refreshLocalReports = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const [submissions, cloudHistory] = await Promise.all([listLocalReportSubmissions(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL), listEnterpriseReportHistory()]);
      const localReports = submissions.map(reportFromLocalSubmission);
      const cloudReports = cloudHistory.map(reportFromCloudSubmission);
      setReportsHistory(mergeReportHistory(localReports, cloudReports));
      setLedgerError(null);
    } catch (error) {
      setLedgerError(error instanceof Error ? error.message : "Unable to load local report ledger.");
    }
  }, [setReportsHistory]);

  const refreshPendingPeriods = useCallback(async () => {
    try {
      const preparation = await getDesktopMockPreparation();
      const pendingCounts =
        preparation?.status === "active"
          ? (preparation.pendingCounts?.length ? preparation.pendingCounts : preparation.counts ? [preparation.counts] : [])
          : [];
      pendingCounts.forEach(reportingPeriodForPreparationCounts);
      setPendingPeriodCounts(pendingCounts);
    } catch (error) {
      setPendingPeriodCounts([]);
      setLedgerError(error instanceof Error ? error.message : "Prepared counts have no canonical reporting period.");
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
    const storedDemo = isReadOnly ? null : loadStoredDemographicDraft(demographicDraftStorageKey);
    if (storedDemo) {
      setDemo(storedDemo);
    } else if (activeReportId) {
      const report = reportsHistoryRef.current.find((item) => item.id === activeReportId);
      setDemo(report?.demo ?? emptyDemo());
    } else {
      setDemo(emptyDemo());
    }
    setHydratedDemographicDraftKey(demographicDraftStorageKey);
  }, [activeReportId, demographicDraftStorageKey, isReadOnly]);

  useEffect(() => {
    if (isReadOnly || hydratedDemographicDraftKey !== demographicDraftStorageKey) return;
    saveStoredDemographicDraft(demographicDraftStorageKey, demo);
  }, [demo, demographicDraftStorageKey, hydratedDemographicDraftKey, isReadOnly]);

  const resetDraftWorkspace = (nextPeriod: CanonicalReportingPeriod | null = liveReportingPeriod) => {
    setActiveReportId(null);
    setReportingPeriod(nextPeriod);
    setNotes("");
    setDemo(emptyDemo());
    setPreviewReport(null);
  };

  const handleDraftPeriodSelect = async (nextPeriod: CanonicalReportingPeriod) => {
    const hasPreparedCounts = pendingPeriodCounts.some(
      (counts) => reportingPeriodForPreparationCounts(counts).periodId === nextPeriod.periodId,
    );
    if (!activeReportId && nextPeriod.periodId === reportingPeriod?.periodId && (liveReportingPeriod?.periodId === nextPeriod.periodId || !hasPreparedCounts)) return;

    if (liveReportingPeriod?.periodId === nextPeriod.periodId && !hasPreparedCounts) {
      resetDraftWorkspace(liveReportingPeriod);
      return;
    }

    if (!hasPreparedCounts) {
      setActiveReportId(null);
      setReportingPeriod(null);
      setNotes("");
      setDemo(emptyDemo());
      setPreviewReport(null);
      return;
    }

    setIsPeriodChanging(true);
    try {
      const prepared = await prepareDesktopMockCounts(nextPeriod.periodId);
      if (!isPreparedMetrics(prepared) || (prepared.prepared === false && prepared.period_id !== nextPeriod.periodId)) {
        throw new Error(`No prepared count package is available for ${nextPeriod.label}.`);
      }
      const preparedPeriod = canonicalReportingPeriodFromSource(prepared);
      setActiveReportId(null);
      setLiveMetrics(metricsFromSummary(prepared));
      setLiveReportingPeriod(preparedPeriod);
      setReportingPeriod(preparedPeriod);
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
    setReportingPeriod(report.reportingPeriod ?? null);
    setNotes(report.notes || "");
    setDemo(report.demo || emptyDemo());
  };

  const handleSelectLedgerRow = (row: ReportLedgerRow) => {
    if (row.kind === "history") {
      handleViewReport(row.report);
      return;
    }

    if (!row.report.reportingPeriod) {
      const message = "This ledger row has no canonical reporting period. Refresh it before preparing a report.";
      setMetricsError(message);
      notifyError(message);
      return;
    }
    void handleDraftPeriodSelect(row.report.reportingPeriod);
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
      reportId: report.id,
      period: report.period ?? report.date,
      metrics: reportMetrics,
      demo: reportDemo,
      notes: report.notes ?? "",
    });
  };

  const executeSubmit = async () => {
    setIsSubmitting(true);
    const submitValidationError = validateReportDraft(displayedMetrics, demo, reportingPeriod, reportsHistory, activeReportId, {
      checkDuplicatePeriod: true,
      checkReportingPeriod: true,
    });
    if (submitValidationError || !reportingPeriod) {
      notifyError(submitValidationError ?? "No canonical reporting period is selected.");
      setIsSubmitting(false);
      return;
    }
    const submissionPeriod = reportingPeriod;

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
            action: "Report Prepared",
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
      periodKey: submissionPeriod.periodId,
      sourceWindow: {
        start: submissionPeriod.startsAtUtc,
        end: submissionPeriod.endsAtUtc,
      },
      status: nextStatus,
    };

    let submission: LocalReportSubmission;
    try {
      const status = await getMlServiceStatus();
      submission = await recordLocalReportSubmission(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, {
        metrics: {
          entries: reportMetrics.entries,
          exits: reportMetrics.exits,
          peakOccupancy: reportMetrics.peak,
          uniqueCount: reportMetrics.unique,
        },
        notes,
        periodId: submissionPeriod.periodId,
        startsAtUtc: submissionPeriod.startsAtUtc,
        endsAtUtc: submissionPeriod.endsAtUtc,
        reportId,
        reportPayload,
      });
    } catch (error) {
      setMetricsError(error instanceof Error ? error.message : "Unable to save report submission locally.");
      setIsSubmitting(false);
      return;
    }
    const cloudSyncError = await syncSubmittedReportToCloud(reportId, submission.outbox_item_id);
    const submittedSyncStatus = cloudSyncError ? submission.sync_status : "synced";
    const restoredWorkspaceMetrics = !cloudSyncError && !activeReportId ? await prepareNextWorkspaceMetrics() : null;
    let restoredWorkspacePeriod: CanonicalReportingPeriod | null = null;

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
              reportingPeriod: submissionPeriod,
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
        reportingPeriod: submissionPeriod,
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
    removeStoredDemographicDraft(demographicDraftStorageKey);
    setShowConfirm(false);
    setIsSubmitting(false);
    if (restoredWorkspaceMetrics) {
      setLiveMetrics(metricsFromSummary(restoredWorkspaceMetrics));
      try {
        restoredWorkspacePeriod = canonicalReportingPeriodFromSource(restoredWorkspaceMetrics);
        setLiveReportingPeriod(restoredWorkspacePeriod);
      } catch (error) {
        setLiveReportingPeriod(null);
        setMetricsError(error instanceof Error ? error.message : "The next reporting period is not classified.");
      }
    } else {
      void refreshLocalMetrics();
    }
    void refreshLocalReports();
    void refreshPendingPeriods();
    if (cloudSyncError) {
      notifyError(`Report saved locally, but cloud sync is still pending: ${cloudSyncError}`);
      window.dispatchEvent(new Event(DESKTOP_REPORT_SYNC_EVENT));
    }
    resetDraftWorkspace(restoredWorkspacePeriod);
  };

  return (
    <div className="animate-in fade-in space-y-6 font-['Inter'] duration-500">
      {previewReport && (
        <DotFormModal
          demo={previewReport.demo}
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
          {metricsError && <p className="mt-1 text-xs font-semibold text-red-600">Local metrics unavailable: {metricsError}</p>}
          {ledgerError && <p className="mt-1 text-xs font-semibold text-red-600">Report ledger unavailable: {ledgerError}</p>}
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
  reportingPeriod: CanonicalReportingPeriod | null,
  reports: ReportRecord[],
  activeReportId: string | null,
  options: { checkDuplicatePeriod: boolean; checkReportingPeriod: boolean },
) {
  if (options.checkReportingPeriod) {
    const periodSubmissionError = getReportingPeriodSubmissionError(reportingPeriod);
    if (periodSubmissionError) return periodSubmissionError;
  }
  const allocationError = validateDemographicAllocation(metrics, demo);
  if (allocationError) return allocationError;
  if (
    options.checkDuplicatePeriod &&
    reportingPeriod &&
    reports.some(
      (report) => report.id !== activeReportId && report.reportingPeriod?.periodId === reportingPeriod.periodId && report.status !== "Draft",
    )
  ) {
    return `A report for ${reportingPeriod.label} has already been submitted.`;
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

function metricsFromPendingCounts(counts: BackendMockPreparationCounts): Metrics {
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

function getDemographicDraftStorageKey(activeReportId: string | null, period: CanonicalReportingPeriod | null) {
  const scope = activeReportId ? `report:${activeReportId}` : period ? `period:${period.periodId}` : "period:unclassified";
  return `${DEMOGRAPHIC_DRAFT_STORAGE_PREFIX}:${encodeURIComponent(scope)}`;
}

function loadStoredDemographicDraft(storageKey: string): DemoBreakdown | null {
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (!storedValue) return null;
    const parsed = JSON.parse(storedValue) as { demo?: unknown };
    return demoFromPayload(parsed.demo);
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

function saveStoredDemographicDraft(storageKey: string, demo: DemoBreakdown) {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        demo,
        savedAt: new Date().toISOString(),
        version: 1,
      }),
    );
  } catch {
    // Local draft persistence is best-effort and must not block report editing.
  }
}

function removeStoredDemographicDraft(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Local draft persistence is best-effort and must not block report submission.
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
  currentPeriod: CanonicalReportingPeriod | null;
  pendingCounts: BackendMockPreparationCounts[];
  reportsHistory: ReportRecord[];
}): ReportLedgerRow[] {
  const pendingPeriods = new Set<string>();
  const rows: ReportLedgerRow[] = [
    {
      key: draftLedgerKey(currentPeriod),
      kind: "current",
      report: {
        id: "TANAW-DRAFT",
        date: currentPeriod?.label ?? UNCLASSIFIED_REPORTING_PERIOD_LABEL,
        status: "Draft",
        entries: currentMetrics.entries,
        exits: currentMetrics.exits,
        peak: currentMetrics.peak,
        unique: currentMetrics.unique,
        period: currentPeriod?.label ?? UNCLASSIFIED_REPORTING_PERIOD_LABEL,
        reportingPeriod: currentPeriod ?? undefined,
        demo: currentDemo,
        notes: currentNotes,
      },
      reportLabel: "Current Reporting Period",
      reportDescription: "Live workspace",
      statusLabel: "Current Reporting Period",
    },
  ];

  for (const counts of pendingCounts) {
    const pendingPeriod = reportingPeriodForPreparationCounts(counts);
    if (pendingPeriod.periodId === currentPeriod?.periodId || pendingPeriods.has(pendingPeriod.periodId)) continue;
    pendingPeriods.add(pendingPeriod.periodId);
    rows.push({
      key: draftLedgerKey(pendingPeriod),
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
      reportDescription: report.syncStatus ? `Sync: ${report.syncStatus}` : "Saved report",
      statusLabel: report.status,
    })),
  );

  return rows;
}

function reportFromPendingCounts(counts: BackendMockPreparationCounts): ReportRecord {
  const reportingPeriod = reportingPeriodForPreparationCounts(counts);
  return {
    id: pendingReportId(reportingPeriod.periodId),
    date: reportingPeriod.label,
    status: "Draft",
    entries: counts.entries,
    exits: counts.exits,
    peak: counts.peakOccupancy,
    unique: counts.uniqueCount,
    period: reportingPeriod.label,
    reportingPeriod,
    demo: loadStoredDemographicDraft(getDemographicDraftStorageKey(null, reportingPeriod)) ?? emptyDemo(),
    notes: "",
  };
}

function draftLedgerKey(period: CanonicalReportingPeriod | null) {
  return `draft:${period?.periodId ?? "unclassified"}`;
}

function historyLedgerKey(reportId: string) {
  return `history:${reportId}`;
}

function pendingReportId(period: string) {
  const normalizedPeriod = period.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase();
  return normalizedPeriod ? `PENDING-${normalizedPeriod}` : "PENDING-REPORT";
}

function reportFromLocalSubmission(submission: LocalReportSubmissionRecord): ReportRecord {
  const payload = submission.payload;
  const payloadStatus = typeof payload.status === "string" && isReportStatus(payload.status) ? payload.status : "Submitted";
  const payloadNotes = typeof payload.notes === "string" ? payload.notes : undefined;
  const metrics = metricsFromLocalSubmission(submission);
  const reportingPeriod = canonicalReportingPeriodFromSource(submission);

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

function reportFromCloudSubmission(report: EnterpriseIntakeReport): ReportRecord {
  const peak = typeof report.metrics.peak === "number" ? report.metrics.peak : Number(report.metrics.peak) || 0;
  const payloadStatus = typeof report.payload?.status === "string" && isReportStatus(report.payload.status) ? report.payload.status : "Submitted";
  const status = report.status === "Returned" ? "Returned for Revision" : report.status === "Consolidated" ? "Consolidated" : report.status === "Pending Review" ? payloadStatus : "Submitted";
  const reportingPeriod = reportingPeriodFromPayload(report.payload);
  return {
    id: report.code,
    date: report.period,
    status,
    entries: report.metrics.entry,
    exits: report.metrics.exit,
    peak,
    unique: report.metrics.unique,
    period: report.period,
    reportingPeriod: reportingPeriod ?? undefined,
    demo: demoFromPayload(report.payload?.demo),
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

async function syncSubmittedReportToCloud(reportId: string, outboxItemId: string) {
  try {
    await syncDesktopReportSubmission(reportId, outboxItemId);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The backend could not be reached.";
  }
}

async function prepareNextWorkspaceMetrics() {
  try {
    const prepared = await prepareDesktopMockCounts();
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

function reportingPeriodFromPayload(payload: Record<string, unknown> | null | undefined): CanonicalReportingPeriod | null {
  if (!payload) return null;
  const sourceWindow = payload.sourceWindow;
  if (!sourceWindow || typeof sourceWindow !== "object") return null;
  const window = sourceWindow as Record<string, unknown>;
  try {
    return canonicalReportingPeriodFromSource({
      period_id: payload.periodKey,
      period: payload.period,
      starts_at_utc: window.start,
      ends_at_utc: window.end,
    });
  } catch {
    return null;
  }
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
  return typeof value === "string" ? value : typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : "";
}

function nonNegativeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}
