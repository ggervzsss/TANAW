import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DailyOrigins, DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, deleteLocalReportDraft, getEstablishmentSummary, getMlServiceStatus, recordLocalReportSubmission } from "../../camera/services/ml-service";
import { DESKTOP_REPORT_SYNC_EVENT } from "../../sync/services/cloud-sync";
import { downloadDotReportPdf } from "../utils/pdf";
import { formatReportingPeriodLabel, isSameReportingMonth } from "../utils/reporting-period";
import { notifyError } from "../../toasts/services/toast-service";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { formatPhilippineDateTime } from "../../../utils/date-time";
import {
  buildLedgerRows,
  draftLedgerKey,
  emptyDemo,
  getDemographicDraftKey,
  historyLedgerKey,
  metricsFromReport,
  upsertReport,
  validateDemographicAllocation,
  validateReportDraft,
  reportFromLocalSubmission,
} from "../model/report-workspace";
import { getCurrentReportingPeriod } from "../model/reporting-calendar";
import { syncSubmittedReportToCloud } from "../services/report-workspace";
import type { ReportLedgerRow } from "../model/report-ledger";
import { useCurrentReportingPeriod } from "./useCurrentReportingPeriod";
import { useAuthStore } from "../../login/stores/auth-store";
import { useOriginsDraft } from "./useOriginsDraft";
import { monthlyDemoFromDays, reportDays } from "../model/daily-origins";
import { metricsFromEstablishment, reportBaselineError, useReportsWorkspaceData } from "./useReportsWorkspaceData";

type Options = { enterpriseName: string; reportsHistory: ReportRecord[]; setReportsHistory: Dispatch<SetStateAction<ReportRecord[]>> };
type Preview = { demo: DemoBreakdown; origins?: DailyOrigins; metrics: Metrics; notes: string; period: SystemLogPeriod; reportId: string };

export function useReportsWorkspace({ enterpriseName, reportsHistory, setReportsHistory }: Options) {
  const { timeFormat } = useSystemDisplayPreferences();
  const currentReportingPeriod = useCurrentReportingPeriod();
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [period, setPeriod] = useState(currentReportingPeriod);
  const [notes, setNotes] = useState("");
  const [previewReport, setPreviewReport] = useState<Preview | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [revisionMetrics, setRevisionMetrics] = useState<Metrics | null>(null);
  const submitting = useRef(false);
  const refreshSequence = useRef(0);
  const pendingOperation = useRef<{ key: string; reportId: string; requestId: string; auditTrail: NonNullable<ReportRecord["auditTrail"]> } | null>(null);
  const activeReport = activeReportId ? (reportsHistory.find((item) => item.id === activeReportId) ?? null) : null;
  const isReadOnly = activeReport ? !["Draft", "Returned for Revision"].includes(activeReport.status) : false;
  const demographicDraftKey = useMemo(() => getDemographicDraftKey(activeReportId, period), [activeReportId, period]);
  const { origins, setOrigins, isHydrating } = useOriginsDraft({ activeReportId, draftKey: demographicDraftKey, isReadOnly, period, reportsHistory });
  const data = useReportsWorkspaceData({ currentReportingPeriod, period, setReportsHistory, timeFormat });
  const displayedMetrics = revisionMetrics ?? (activeReport ? metricsFromReport(activeReport) : data.liveMetrics);
  // Submitted reports made before daily entry keep their monthly totals only.
  const hasDailyOrigins = !isReadOnly || activeReport?.origins !== undefined;
  const days = useMemo(() => reportDays(period, displayedMetrics, origins), [period, displayedMetrics, origins]);
  const derivedDemo = useMemo(() => monthlyDemoFromDays(days), [days]);
  const demo = isReadOnly && activeReport?.demo ? activeReport.demo : derivedDemo;
  const blockingMetricsError = revisionMetrics?.counting ? reportBaselineError(revisionMetrics.counting) : activeReport?.counting ? null : data.metricsError;
  const validationError = validateReportDraft(displayedMetrics, demo, isReadOnly ? [] : days, period, reportsHistory, activeReportId, {
    checkDuplicatePeriod: !isReadOnly,
    checkReportingPeriod: !isReadOnly,
  });
  const ledgerRows = useMemo(
    () =>
      buildLedgerRows({
        currentDemo: !activeReport && isSameReportingMonth(period, currentReportingPeriod) ? demo : emptyDemo(),
        currentOrigins: !activeReport && isSameReportingMonth(period, currentReportingPeriod) ? origins : {},
        currentMetrics: data.currentMetrics,
        currentNotes: !activeReport && isSameReportingMonth(period, currentReportingPeriod) ? notes : "",
        currentPeriod: currentReportingPeriod,
        pendingCounts: data.pendingPeriodCounts,
        reportsHistory,
      }),
    [activeReport, period, currentReportingPeriod, demo, origins, data.currentMetrics, data.pendingPeriodCounts, notes, reportsHistory],
  );
  const activeLedgerKey = activeReport ? historyLedgerKey(activeReport.id) : draftLedgerKey(period);

  const handleSelectLedgerRow = (row: ReportLedgerRow) => {
    if (submitting.current) return;
    refreshSequence.current += 1;
    pendingOperation.current = null;
    setIsRefreshing(false);
    setRevisionMetrics(null);
    setPreviewReport(null);
    const nextReportId = row.kind === "history" ? row.report.id : null;
    const nextPeriod = row.report.period ?? row.report.date ?? getCurrentReportingPeriod();
    setActiveReportId(nextReportId);
    setPeriod(nextPeriod);
    setNotes(row.kind === "history" ? (row.report.notes ?? "") : "");
    // Another report loads its own draft. Clearing the open one would save the blank and delete its draft.
    if (getDemographicDraftKey(nextReportId, nextPeriod) !== demographicDraftKey) setOrigins(row.kind === "history" ? (row.report.origins ?? {}) : {});
  };
  const handlePreviewReport = (report: ReportRecord) =>
    setPreviewReport({
      demo: report.demo ?? emptyDemo(),
      origins: report.origins,
      metrics: metricsFromReport(report),
      notes: report.notes ?? "",
      period: report.period ?? report.date,
      reportId: report.id,
    });
  const handleDownloadReport = (report: ReportRecord) => {
    const metrics = metricsFromReport(report);
    const reportDemo = report.demo ?? emptyDemo();
    const error = validateDemographicAllocation(metrics, reportDemo);
    if (error) {
      notifyError(error);
      handlePreviewReport(report);
      return;
    }
    downloadDotReportPdf({
      enterpriseName,
      reportId: report.id,
      period: formatReportingPeriodLabel(report.period ?? report.date),
      metrics,
      demo: reportDemo,
      origins: report.origins,
      notes: report.notes ?? "",
      attractionType: useAuthStore.getState().user?.category ?? undefined,
    });
  };
  const refreshRevisionCounts = async () => {
    if (isReadOnly || !activeReport) return;
    const sequence = ++refreshSequence.current;
    const enterpriseId = useAuthStore.getState().user?.enterpriseId;
    setIsRefreshing(true);
    try {
      const status = await getMlServiceStatus();
      const snapshot = await getEstablishmentSummary(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, { period });
      if (sequence !== refreshSequence.current || useAuthStore.getState().user?.enterpriseId !== enterpriseId) return;
      if (snapshot.enterprise_id !== enterpriseId) throw new Error("The report counts belong to another establishment.");
      const error = reportBaselineError(snapshot);
      if (error) throw new Error(error);
      setRevisionMetrics(metricsFromEstablishment(snapshot));
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Unable to refresh reconciled counts.");
    } finally {
      if (sequence === refreshSequence.current) setIsRefreshing(false);
    }
  };

  const executeSubmit = async () => {
    if (submitting.current || isReadOnly) return;
    const error = blockingMetricsError ?? validateReportDraft(displayedMetrics, demo, days, period, reportsHistory, activeReportId, { checkDuplicatePeriod: true, checkReportingPeriod: true });
    if (error) {
      notifyError(error);
      return;
    }
    const counting = displayedMetrics.counting;
    if (!counting) {
      notifyError("Refresh the period to load its reconciled snapshot.");
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    const enterpriseId = useAuthStore.getState().user?.enterpriseId;
    if (counting.enterprise_id !== enterpriseId) {
      submitting.current = false;
      setIsSubmitting(false);
      notifyError("Reconnect this establishment before submitting.");
      return;
    }
    const statusLabel = activeReportId ? "Resubmitted" : "Submitted";
    const key = JSON.stringify({ enterpriseId, activeReportId, period, notes, origins, snapshot: counting.snapshot_version });
    if (pendingOperation.current?.key !== key)
      pendingOperation.current = {
        key,
        reportId: activeReportId ?? `REP-${crypto.randomUUID().slice(0, 12)}`,
        requestId: crypto.randomUUID(),
        auditTrail: [
          ...(activeReport?.auditTrail ?? []),
          { time: formatPhilippineDateTime(new Date(), timeFormat), action: activeReportId ? "Report Resubmitted" : "Report Submitted", actor: "Enterprise User" },
        ],
      };
    const { reportId, requestId, auditTrail } = pendingOperation.current;
    try {
      const serviceStatus = await getMlServiceStatus();
      const base = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
      if (useAuthStore.getState().user?.enterpriseId !== enterpriseId) return;
      const submission = await recordLocalReportSubmission(base, {
        requestId,
        expectedSnapshotVersion: counting.snapshot_version,
        metrics: { entries: displayedMetrics.entries, exits: displayedMetrics.exits, peakOccupancy: displayedMetrics.peak, uniqueCount: displayedMetrics.unique },
        notes,
        period,
        reportId,
        reportPayload: {
          auditTrail,
          demo,
          origins,
          notes,
          period,
          status: statusLabel,
          // The service normalizes demo to its canonical province fields; the city subset travels separately.
          var1: { thisCityMale: demo.thisCityMale ?? "", thisCityFemale: demo.thisCityFemale ?? "", thisCityUnspecified: demo.thisCityUnspecified ?? "" },
        },
      });
      if (useAuthStore.getState().user?.enterpriseId !== enterpriseId) return;
      pendingOperation.current = null;
      // Reflect the saved server snapshot immediately, including when upload fails.
      let report = reportFromLocalSubmission({ ...submission, notes, sync_status: submission.sync_status, synced_at: null, camera_breakdown: submission.camera_breakdown }, timeFormat);
      setReportsHistory((current) => upsertReport(current, report));
      const cloudError = await syncSubmittedReportToCloud(reportId);
      if (!cloudError) {
        report = { ...report, syncStatus: "synced" };
        setReportsHistory((current) => upsertReport(current, report));
      } else {
        notifyError(`Report saved on this device and waiting to upload: ${cloudError}`);
        window.dispatchEvent(new Event(DESKTOP_REPORT_SYNC_EVENT));
      }
      try {
        await deleteLocalReportDraft(base, demographicDraftKey);
      } catch {
        /* The submission is already durable. */
      }
      setShowConfirm(false);
      setActiveReportId(reportId);
      setRevisionMetrics(null);
      void data.refreshLocalReports();
      void data.refreshLocalMetrics();
    } catch (issue) {
      notifyError(issue instanceof Error ? issue.message : "Unable to save the report.");
      void data.refreshLocalReports();
      void data.refreshLocalMetrics();
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return {
    activeLedgerKey,
    activeReport,
    activeReportId,
    blockingMetricsError,
    days,
    demo,
    displayedMetrics,
    enterpriseName,
    executeSubmit,
    handleDownloadReport,
    handlePreviewReport,
    handleSelectLedgerRow,
    hasDailyOrigins,
    isPeriodChanging: (!activeReport && data.loading) || isRefreshing || isHydrating,
    isReadOnly,
    isSubmitting,
    ledgerRows,
    notes,
    period,
    origins,
    previewReport,
    refreshRevisionCounts,
    setNotes,
    setOrigins,
    setPreviewReport,
    setShowConfirm,
    showConfirm,
    validationError,
  };
}
