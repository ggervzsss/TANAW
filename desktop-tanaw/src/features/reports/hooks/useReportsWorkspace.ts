import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DailyOrigins, DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, deleteLocalReportDraft, getEstablishmentSummary, getMlServiceStatus, recordLocalReportSubmission } from "../../camera/services/ml-service";
import { DESKTOP_REPORT_SYNC_EVENT } from "../../sync/services/cloud-sync";
import { downloadDotReportPdf } from "../utils/pdf";
import { formatReportingPeriodLabel, isSameReportingMonth } from "../utils/reporting-period";
import { notifyError, notifySuccess, notifyWarning } from "../../toasts/services/toast-service";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { formatReportAttraction } from "../../../utils/attractions";
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
  reportSubmissionErrorMessage,
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
type Preview = { attractionType?: string; demo: DemoBreakdown; origins?: DailyOrigins; metrics: Metrics; notes: string; period: SystemLogPeriod; reportId: string };

export function useReportsWorkspace({ enterpriseName, reportsHistory, setReportsHistory }: Options) {
  const { timeFormat } = useSystemDisplayPreferences();
  const currentReportingPeriod = useCurrentReportingPeriod();
  const currentAttraction = useAuthStore((state) => state.user?.attraction);
  const attractionDescription = useAuthStore((state) => state.user?.attractionDescription);
  const currentAttractionType = formatReportAttraction(currentAttraction?.code, attractionDescription);
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
  const attractionType = isReadOnly ? activeReport?.attractionType : currentAttractionType;
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
      attractionType: report.status === "Draft" ? currentAttractionType : report.attractionType,
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
      notifyWarning(error);
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
      attractionType: report.status === "Draft" ? currentAttractionType : report.attractionType,
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
      notifyWarning(error);
      return;
    }
    const counting = displayedMetrics.counting;
    if (!counting) {
      notifyWarning("Refresh the period to load its reconciled counts before submitting.");
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    const user = useAuthStore.getState().user;
    const enterpriseId = user?.enterpriseId;
    const attractionCode = user?.attraction?.code;
    const attractionDescription = user?.attractionDescription;
    if (counting.enterprise_id !== enterpriseId) {
      submitting.current = false;
      setIsSubmitting(false);
      notifyWarning("Reconnect this establishment before submitting.");
      return;
    }
    const statusLabel = activeReportId ? "Resubmitted" : "Submitted";
    const key = JSON.stringify({ enterpriseId, attractionCode, attractionDescription, activeReportId, period, notes, origins, snapshot: counting.snapshot_version });
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
    const toastId = `report-submission:${reportId}`;
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
          attractionCode,
          attractionDescription,
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
      // Keep the durable local record available even if the online submission fails.
      const report = reportFromLocalSubmission({ ...submission, notes, synced_at: null }, timeFormat);
      setReportsHistory((current) => upsertReport(current, report));
      const cloudResult = await syncSubmittedReportToCloud(submission.report_id, submission.submission_id);
      if (useAuthStore.getState().user?.enterpriseId !== enterpriseId) return;
      const reference = submission.report_id;
      if (cloudResult === "confirmed") {
        setReportsHistory((current) => upsertReport(current, { ...report, syncStatus: "synced" }));
        notifySuccess(`Report ${activeReportId ? "resubmitted" : "submitted"} successfully. Reference ${reference}.`, toastId);
      } else {
        if (cloudResult === "rejected") {
          notifyError(`TANAW could not upload report ${reference}. A copy is saved on this device. Check Reports History for its upload status.`, toastId);
        } else {
          notifyWarning(`Report ${reference} was saved on this device. TANAW will retry the upload.`, toastId);
        }
        window.dispatchEvent(new Event(DESKTOP_REPORT_SYNC_EVENT));
      }
      try {
        await deleteLocalReportDraft(base, demographicDraftKey);
      } catch {
        /* The submission is already durable. */
      }
      setShowConfirm(false);
      setActiveReportId(reference);
      setRevisionMetrics(null);
      void data.refreshLocalReports();
      void data.refreshLocalMetrics();
    } catch (issue) {
      if (useAuthStore.getState().user?.enterpriseId !== enterpriseId) return;
      notifyError(reportSubmissionErrorMessage(issue), toastId);
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
    attractionType,
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
