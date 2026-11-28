import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DailyOrigins, DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, deleteLocalReportDraft, getMlServiceStatus, recordLocalReportSubmission, reopenLocalReportSubmission } from "../../camera/services/ml-service";
import { DESKTOP_REPORT_SYNC_EVENT } from "../../sync/services/cloud-sync";
import { downloadDotReportPdf } from "../utils/pdf";
import { formatReportingPeriodLabel, isSameReportingMonth } from "../utils/reporting-period";
import { notifySuccess, notifyWarning } from "../../toasts/services/toast-service";
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
  reopenReportErrorMessage,
  reportFromLocalSubmission,
  reportSubmissionIssue,
  type ReportSubmissionIssue,
} from "../model/report-workspace";
import { canReopenReport, correctionSource, reportLifecycle, reportsNeedingAction } from "../model/report-lifecycle";
import { getCurrentReportingPeriod } from "../model/reporting-calendar";
import { syncSubmittedReportToCloud } from "../services/report-workspace";
import type { ReportLedgerRow } from "../model/report-ledger";
import { reportMonthRows } from "../utils/report-ledger";
import { useCurrentReportingPeriod } from "./useCurrentReportingPeriod";
import { useAuthStore } from "../../login/stores/auth-store";
import { useOriginsDraft } from "./useOriginsDraft";
import { monthlyDemoFromDays, reportDays } from "../model/daily-origins";
import { useReportsWorkspaceData } from "./useReportsWorkspaceData";

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
  // Why the last send failed, shown in the submit dialog where the person is.
  const [submitIssue, setSubmitIssue] = useState<ReportSubmissionIssue | null>(null);
  const [reopeningReportId, setReopeningReportId] = useState<string | null>(null);
  const [reopenIssue, setReopenIssue] = useState<string | null>(null);
  // Bumped when a send ends, so the report panel can move focus to its new status.
  const [statusAnnouncement, setStatusAnnouncement] = useState(0);
  const submitting = useRef(false);
  const draftNotes = useRef(new Map<string, string>());
  const pendingOperation = useRef<{ key: string; reportId: string; requestId: string; auditTrail: NonNullable<ReportRecord["auditTrail"]> } | null>(null);
  const activeReport = activeReportId ? (reportsHistory.find((item) => item.id === activeReportId) ?? null) : null;
  // A sent report is read-only. If TANAW refuses it, the person reopens the month to fix it and
  // send it again; a report TANAW accepted is final.
  const isReadOnly = activeReport ? activeReport.status !== "Draft" : false;
  const attractionType = isReadOnly ? activeReport?.attractionType : currentAttractionType;
  const demographicDraftKey = useMemo(() => getDemographicDraftKey(activeReportId, period), [activeReportId, period]);
  const { origins, setOrigins, isHydrating } = useOriginsDraft({ activeReportId, draftKey: demographicDraftKey, isReadOnly, period, reportsHistory });
  const data = useReportsWorkspaceData({ currentReportingPeriod, period, setReportsHistory, timeFormat });
  const displayedMetrics = activeReport ? metricsFromReport(activeReport) : data.liveMetrics;
  // Submitted reports made before daily entry keep their monthly totals only.
  const hasDailyOrigins = !isReadOnly || activeReport?.origins !== undefined;
  const days = useMemo(() => reportDays(period, displayedMetrics, origins), [period, displayedMetrics, origins]);
  const derivedDemo = useMemo(() => monthlyDemoFromDays(days), [days]);
  const demo = isReadOnly && activeReport?.demo ? activeReport.demo : derivedDemo;
  const blockingMetricsError = activeReport?.counting ? null : data.metricsError;
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
  const lifecycle = useMemo(() => reportLifecycle(activeReport, reportsHistory, period), [activeReport, reportsHistory, period]);
  // Refused reports of other months, so they are found from whichever month is open.
  const reportsAwaitingAction = useMemo(() => reportsNeedingAction(reportsHistory).filter((report) => !isSameReportingMonth(report.period ?? report.date, period)), [reportsHistory, period]);
  // The months the Tourism Period picker switches between, oldest first.
  const monthRows = useMemo(() => reportMonthRows(ledgerRows), [ledgerRows]);
  const months = useMemo(() => monthRows.map((row) => row.report.period ?? row.report.date), [monthRows]);

  /** Opens a reporting month in Create Reports: its submitted report read-only, else its draft. */
  const openMonth = (row: ReportLedgerRow) => {
    if (submitting.current) return;
    pendingOperation.current = null;
    setPreviewReport(null);
    setReopenIssue(null);
    const nextReportId = row.kind === "history" ? row.report.id : null;
    const nextPeriod = row.report.period ?? row.report.date ?? getCurrentReportingPeriod();
    // Notes typed on a draft month wait for it while another month is open.
    if (!isReadOnly) draftNotes.current.set(demographicDraftKey, notes);
    setActiveReportId(nextReportId);
    setPeriod(nextPeriod);
    // A month being fixed starts from the notes of the refused report.
    setNotes(
      row.kind === "history" ? (row.report.notes ?? "") : (draftNotes.current.get(getDemographicDraftKey(nextReportId, nextPeriod)) ?? correctionSource(reportsHistory, nextPeriod)?.notes ?? ""),
    );
    // Another report loads its own draft. Clearing the open one would save the blank and delete its draft.
    if (getDemographicDraftKey(nextReportId, nextPeriod) !== demographicDraftKey) setOrigins(row.kind === "history" ? (row.report.origins ?? {}) : {});
  };
  const handleSelectPeriod = (next: string) => {
    if (isSameReportingMonth(next, period)) return;
    const row = monthRows.find((item) => isSameReportingMonth(item.report.period ?? item.report.date, next));
    if (row) openMonth(row);
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
  const openSubmitDialog = () => {
    setSubmitIssue(null);
    setShowConfirm(true);
  };
  // Nothing closes the dialog while the report is being sent.
  const closeSubmitDialog = () => {
    if (submitting.current) return;
    setSubmitIssue(null);
    setShowConfirm(false);
  };
  const executeSubmit = async () => {
    if (submitting.current || isReadOnly) return;
    const error = blockingMetricsError ?? validateReportDraft(displayedMetrics, demo, days, period, reportsHistory, activeReportId, { checkDuplicatePeriod: true, checkReportingPeriod: true });
    if (error) {
      setSubmitIssue({ message: error, canRetry: false });
      return;
    }
    const counting = displayedMetrics.counting;
    if (!counting) {
      setSubmitIssue({ message: "TANAW is still loading this month's counts. Wait a moment, then try again.", canRetry: true });
      return;
    }
    const user = useAuthStore.getState().user;
    const enterpriseId = user?.enterpriseId;
    const attractionCode = user?.attraction?.code;
    const attractionDescription = user?.attractionDescription;
    if (counting.enterprise_id !== enterpriseId) {
      // The counts on this computer are not yet linked to the signed-in establishment.
      setSubmitIssue({
        message:
          "TANAW on this computer is still connecting to your establishment's account. Check this computer's internet connection, then try again. If this keeps happening, sign out and sign in again.",
        canRetry: true,
      });
      void data.refreshLocalMetrics();
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    setSubmitIssue(null);
    const key = JSON.stringify({ enterpriseId, attractionCode, attractionDescription, activeReportId, period, notes, origins, snapshot: counting.snapshot_version });
    if (pendingOperation.current?.key !== key)
      pendingOperation.current = {
        key,
        reportId: activeReportId ?? `REP-${crypto.randomUUID().slice(0, 12)}`,
        requestId: crypto.randomUUID(),
        auditTrail: [
          ...(activeReport?.auditTrail ?? []),
          { time: formatPhilippineDateTime(new Date(), timeFormat), action: lifecycle.kind === "correcting" ? "Corrected Report Submitted" : "Report Submitted", actor: "Enterprise User" },
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
          status: "Submitted",
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
      // The report panel keeps the outcome in view: sent, waiting to send, or refused with
      // TANAW's reason and a way to fix it. A toast adds only that the send just finished.
      if (cloudResult.status === "confirmed") {
        setReportsHistory((current) => upsertReport(current, { ...report, syncStatus: "synced" }));
        notifySuccess(lifecycle.kind === "correcting" ? "Corrected report sent." : `Report sent. Reference ${reference}.`, toastId);
      } else {
        if (cloudResult.status === "rejected") {
          setReportsHistory((current) => upsertReport(current, { ...report, syncStatus: "upload_rejected", ...(cloudResult.reason ? { rejectionReason: cloudResult.reason } : {}) }));
        } else {
          notifyWarning(`Report saved on this computer. TANAW will send it when the connection is back. Reference ${reference}.`, toastId);
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
      setStatusAnnouncement((value) => value + 1);
      void data.refreshLocalReports();
      void data.refreshLocalMetrics();
      // TANAW starts its review; show that as soon as it is known.
      if (cloudResult.status === "confirmed") void data.refreshMonthReview(period);
    } catch (issue) {
      if (useAuthStore.getState().user?.enterpriseId !== enterpriseId) return;
      setSubmitIssue(reportSubmissionIssue(issue));
      void data.refreshLocalReports();
      void data.refreshLocalMetrics();
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  /**
   * Reopens a month's report TANAW refused: it stays in Reports History, and the month opens as
   * an editable draft that starts from its figures. Nothing is sent until the person sends the
   * fixed report.
   */
  const reopenForCorrection = async (report: ReportRecord) => {
    if (submitting.current || reopeningReportId || !canReopenReport(report, reportsHistory)) return;
    const enterpriseId = useAuthStore.getState().user?.enterpriseId;
    setReopeningReportId(report.id);
    setReopenIssue(null);
    try {
      const status = await getMlServiceStatus();
      const record = await reopenLocalReportSubmission(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, report.id);
      if (useAuthStore.getState().user?.enterpriseId !== enterpriseId) return;
      const nextPeriod = report.period ?? report.date;
      setReportsHistory((current) => upsertReport(current, { ...report, reopenedAt: record.reopened_at ?? new Date().toISOString() }));
      pendingOperation.current = null;
      setPreviewReport(null);
      draftNotes.current.delete(getDemographicDraftKey(null, nextPeriod));
      setActiveReportId(null);
      setPeriod(nextPeriod);
      setNotes(report.notes ?? "");
      setStatusAnnouncement((value) => value + 1);
      void data.refreshLocalReports();
      void data.refreshLocalMetrics();
    } catch (issue) {
      if (useAuthStore.getState().user?.enterpriseId === enterpriseId) setReopenIssue(reopenReportErrorMessage(issue));
    } finally {
      setReopeningReportId(null);
    }
  };

  return {
    reportsAwaitingAction,
    closeSubmitDialog,
    lifecycle,
    openSubmitDialog,
    reopenForCorrection,
    reopenIssue,
    reopeningReportId,
    statusAnnouncement,
    submitIssue,
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
    handleSelectPeriod,
    hasDailyOrigins,
    isPeriodChanging: (!activeReport && data.loading) || isHydrating,
    isReadOnly,
    isSubmitting,
    ledgerRows,
    months,
    notes,
    period,
    origins,
    previewReport,
    setNotes,
    setOrigins,
    setPreviewReport,
    setShowConfirm,
    showConfirm,
    validationError,
  };
}
