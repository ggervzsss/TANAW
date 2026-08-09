import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  type LocalReportSubmission,
} from "../../camera/services/ml-service";
import { listEnterpriseReportHistory } from "../services/report-history";
import { DESKTOP_REPORT_SYNC_EVENT, getDesktopSamplePreparation, prepareDesktopSampleCounts, type BackendSamplePreparationCounts } from "../../sync/services/cloud-sync";
import { downloadDotReportPdf } from "../utils/pdf";
import { formatReportingPeriodLabel, isSameReportingMonth, shouldPrepareDraftPeriod } from "../utils/reporting-period";
import { notifyError } from "../../toasts/services/toast-service";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { formatPhilippineDateTime } from "../../../utils/date-time";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";
import {
  buildLedgerRows,
  demoFromPayload,
  draftLedgerKey,
  emptyDemo,
  findPreviousDemo,
  getDemographicDraftKey,
  historyLedgerKey,
  isPreparedMetrics,
  mergeReportHistory,
  metricsFromPendingCounts,
  metricsFromReport,
  metricsFromSummary,
  reportFromCloudSubmission,
  reportFromLocalSubmission,
  upsertReport,
  validateDemographicAllocation,
  validateReportDraft,
} from "../model/report-workspace";
import { getCurrentReportingPeriod } from "../model/reporting-calendar";
import { clearLegacyBrowserDemographicDrafts, persistDemographicDraft, prepareNextWorkspaceMetrics, syncSubmittedReportToCloud } from "../services/report-workspace";
import type { ReportLedgerRow } from "../model/report-ledger";
import { useCurrentReportingPeriod } from "./useCurrentReportingPeriod";

type ReportsWorkspaceOptions = {
  enterpriseName: string;
  reportsHistory: ReportRecord[];
  setReportsHistory: Dispatch<SetStateAction<ReportRecord[]>>;
};

type DotPreviewState = {
  demo: DemoBreakdown;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  reportId: string;
};

const DEMOGRAPHIC_DRAFT_RETRY_DELAY_MS = 2000;
const DEMOGRAPHIC_DRAFT_SAVE_DELAY_MS = 300;

export function useReportsWorkspace({ enterpriseName, reportsHistory, setReportsHistory }: ReportsWorkspaceOptions) {
  const { timeFormat } = useSystemDisplayPreferences();
  const currentReportingPeriod = useCurrentReportingPeriod();
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

  return {
    activeLedgerKey,
    activeReport,
    activeReportId,
    blockingMetricsError,
    demo,
    displayedMetrics,
    enterpriseName,
    executeSubmit,
    handleDownloadReport,
    handlePreviewReport,
    handleSelectLedgerRow,
    isPeriodChanging,
    isReadOnly,
    isSubmitting,
    ledgerRows,
    notes,
    period,
    previewReport,
    previousDemo,
    setDemo,
    setNotes,
    setPreviewReport,
    setShowConfirm,
    showConfirm,
    validationError,
  };
}
