import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Files, History } from "lucide-react";
import { routePaths } from "../../../app/router/routePaths";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { DotFormModal } from "./DotFormModal";
import { ReportDraftActions } from "./ReportDraftActions";
import { ReportDraftPanel } from "./ReportDraftPanel";
import { ReportLedgerTable } from "./ReportLedgerTable";
import { SubmitReportDialog } from "./SubmitReportDialog";
import type { Camera, ReportRecord } from "../../../types/enterprise";
import { useReportsWorkspace } from "../hooks/useReportsWorkspace";
import { validateDemographicAllocation } from "../model/report-workspace";
import { dailyOriginsError } from "../model/daily-origins";
import { rejectedUploadTicketDraft, reportReference } from "../model/report-lifecycle";
import { previewActions } from "../model/report-preview";
import { isSameReportingMonth } from "../utils/reporting-period";

type ReportsViewProps = {
  cameras?: Camera[];
  enterpriseName: string;
  reportsHistory: ReportRecord[];
  setReportsHistory: Dispatch<SetStateAction<ReportRecord[]>>;
};

export function ReportsView({ enterpriseName, reportsHistory, setReportsHistory }: ReportsViewProps) {
  const workspace = useReportsWorkspace({ enterpriseName, reportsHistory, setReportsHistory });
  return <ReportsWorkspace workspace={workspace} reportsHistory={reportsHistory} />;
}
function ReportsWorkspace({ workspace, reportsHistory }: { workspace: ReturnType<typeof useReportsWorkspace>; reportsHistory: ReportRecord[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { timeFormat } = useSystemDisplayPreferences();
  const [tab, setTab] = useState<"create" | "history">("create");
  const [reviewedKey, setReviewedKey] = useState("");
  const [previewedLedgerKey, setPreviewedLedgerKey] = useState<string | null>(null);
  const {
    enterpriseName,
    activeLedgerKey,
    activeReport,
    activeReportId,
    attractionType,
    blockingMetricsError,
    days,
    demo,
    displayedMetrics,
    executeSubmit,
    handlePreviewReport,
    handleSelectPeriod,
    hasDailyOrigins,
    isPeriodChanging,
    isReadOnly,
    isSubmitting,
    ledgerRows,
    months,
    notes,
    origins,
    period,
    previewReport,
    setNotes,
    setOrigins,
    setPreviewReport,
    showConfirm,
    validationError,
    closeSubmitDialog,
    lifecycle,
    openSubmitDialog,
    reopenForCorrection,
    reopenIssue,
    reopeningReportId,
    statusAnnouncement,
    submitIssue,
    reportsAwaitingAction,
  } = workspace;
  // Opens Requests with the refused report's month, reference and TANAW's message filled in.
  const askItForHelp = (report: ReportRecord) => navigate(routePaths.enterpriseTickets, { state: { returnTo: location.pathname, ticketDraft: rejectedUploadTicketDraft(report, timeFormat) } });
  const reviewKey = JSON.stringify([period, activeReportId, origins, notes, displayedMetrics.unique, displayedMetrics.counting?.snapshot_version]);
  const previewIsDraft = previewReport?.reportId === (activeReportId ?? "TANAW-DRAFT") && !isReadOnly;
  const previewValidation = previewReport ? ((previewIsDraft ? dailyOriginsError(days) : null) ?? validateDemographicAllocation(previewReport.metrics, previewReport.demo)) : null;
  // A month TANAW does not hold yet (Pending or Missing) offers Submit Form; Print and Download PDF
  // appear once it is Submitted or Consolidated.
  const previewPlan = previewReport ? previewActions({ preview: previewReport, rows: ledgerRows, openPeriod: period, openIsEditable: !isReadOnly }) : null;
  // Submit Form starts the same flow as Submit Report: the preview gives way to the confirmation.
  const submitFromPreview = () => {
    setReviewedKey(reviewKey);
    setPreviewReport(null);
    openSubmitDialog();
  };
  const reviewOpenForm = () =>
    setPreviewReport({
      attractionType,
      demo,
      origins: hasDailyOrigins ? origins : undefined,
      metrics: displayedMetrics,
      notes,
      period,
      reportId: activeReportId ?? "TANAW-DRAFT",
    });
  // Submit Form for another month opens it in Create Reports, as its Tourism Period picker does,
  // and submits it once its counts and visitor details have loaded. Only that month is sent.
  const [submitAfterOpen, setSubmitAfterOpen] = useState<string | null>(null);
  const submitMonth = (target: string) => {
    setSubmitAfterOpen(target);
    selectTab("create");
    handleSelectPeriod(target);
  };
  useEffect(() => {
    if (!submitAfterOpen) return;
    // The month did not open (another send is under way, for example): nothing is sent.
    if (!isSameReportingMonth(period, submitAfterOpen) || isReadOnly) {
      setSubmitAfterOpen(null);
      return;
    }
    if (isPeriodChanging) return;
    setSubmitAfterOpen(null);
    // What still blocks it shows beside Submit Form in that month's form.
    if (blockingMetricsError ?? validationError) reviewOpenForm();
    else submitFromPreview();
    // Runs when the opened month settles; the handlers read that render's values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitAfterOpen, period, isReadOnly, isPeriodChanging]);
  // Reports History only previews: the month in Create Reports changes from its Tourism Period picker.
  const selectTab = (next: "create" | "history") => {
    if (next === "create") setPreviewedLedgerKey(null);
    setTab(next);
  };

  return (
    <div className="tanaw-reports-workspace" data-reports-surface="var1-workspace">
      {previewReport && (
        <DotFormModal
          attractionType={previewReport.attractionType}
          demo={previewReport.demo}
          origins={previewReport.origins}
          enterpriseName={enterpriseName}
          metrics={previewReport.metrics}
          notes={previewReport.notes}
          period={previewReport.period}
          reportId={previewReport.reportId}
          validationMessage={previewPlan?.kind === "export" ? previewValidation : null}
          actions={
            previewPlan?.kind === "submit-open" ? (
              <ReportDraftActions
                label="Submit Form"
                isReadOnly={false}
                isPeriodChanging={isPeriodChanging}
                isLoadingCounts={isPeriodChanging}
                metricsError={blockingMetricsError}
                validationError={validationError}
                onSubmitPrompt={submitFromPreview}
              />
            ) : previewPlan?.kind === "submit-month" ? (
              <ReportDraftActions
                label="Submit Form"
                isReadOnly={false}
                isPeriodChanging={isSubmitting}
                metricsError={null}
                validationError={previewPlan.blocker}
                onSubmitPrompt={() => submitMonth(previewPlan.period)}
              />
            ) : undefined
          }
          onClose={() => {
            if (previewReport.reportId === (activeReportId ?? "TANAW-DRAFT") && !previewValidation && JSON.stringify(previewReport.origins) === JSON.stringify(origins)) setReviewedKey(reviewKey);
            setPreviewReport(null);
          }}
        />
      )}

      {showConfirm && (
        <SubmitReportDialog
          period={period}
          metrics={displayedMetrics}
          demo={demo}
          days={days}
          correction={lifecycle.kind === "correcting" ? { previousId: reportReference(lifecycle.previous) } : null}
          isSubmitting={isSubmitting}
          issue={submitIssue}
          onCancel={closeSubmitDialog}
          onConfirm={executeSubmit}
        />
      )}

      <div className="reports-heading">
        <div>
          <h1>Reports</h1>
          <p>Create and manage your monthly tourism reports.</p>
        </div>
      </div>

      <div className="reports-tabs" role="tablist" aria-label="Reports workspace">
        {(
          [
            ["create", "Create Reports", Files],
            ["history", "Reports History", History],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            id={`reports-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`reports-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "create" : event.key === "End" ? "history" : tab === "create" ? "history" : "create";
              selectTab(next);
              document.getElementById(`reports-tab-${next}`)?.focus();
            }}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div id="reports-panel-create" role="tabpanel" aria-labelledby="reports-tab-create" hidden={tab !== "create"} className="reports-tab-panel">
        <ReportDraftPanel
          attractionType={attractionType}
          enterpriseName={enterpriseName}
          reviewed={reviewedKey === reviewKey}
          activeReport={activeReport}
          days={days}
          demo={demo}
          hasDailyOrigins={hasDailyOrigins}
          isReadOnly={isReadOnly}
          isPeriodChanging={isPeriodChanging}
          metrics={displayedMetrics}
          metricsError={blockingMetricsError}
          months={months}
          onSelectPeriod={handleSelectPeriod}
          notes={notes}
          period={period}
          validationError={validationError}
          onSubmitPrompt={openSubmitDialog}
          lifecycle={lifecycle}
          reports={reportsHistory}
          timeFormat={timeFormat}
          reopeningReportId={reopeningReportId}
          reopenIssue={reopenIssue}
          onCorrect={(report) => void reopenForCorrection(report)}
          onAskForHelp={askItForHelp}
          statusAnnouncement={statusAnnouncement}
          reportsAwaitingAction={reportsAwaitingAction}
          onOpenReportMonth={(report) => handleSelectPeriod(report.period ?? report.date)}
          onReview={reviewOpenForm}
          setOrigins={setOrigins}
          setNotes={setNotes}
        />
      </div>
      <div id="reports-panel-history" role="tabpanel" aria-labelledby="reports-tab-history" hidden={tab !== "history"} className="reports-tab-panel">
        <ReportLedgerTable
          activeLedgerKey={previewedLedgerKey ?? activeLedgerKey}
          ledgerRows={ledgerRows}
          isLoading={isPeriodChanging && !ledgerRows.length}
          onPreviewReport={handlePreviewReport}
          onSelectReport={(row) => setPreviewedLedgerKey(row.key)}
        />
      </div>
    </div>
  );
}
