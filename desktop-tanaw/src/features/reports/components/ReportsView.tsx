import { useState, type Dispatch, type SetStateAction } from "react";
import { Files, History } from "lucide-react";
import { DotFormModal } from "./DotFormModal";
import { ReportDraftPanel } from "./ReportDraftPanel";
import { ReportLedgerTable } from "./ReportLedgerTable";
import { SubmitReportDialog } from "./SubmitReportDialog";
import type { Camera, ReportRecord } from "../../../types/enterprise";
import { useReportsWorkspace } from "../hooks/useReportsWorkspace";
import { validateDemographicAllocation } from "../model/report-workspace";
import { dailyOriginsError } from "../model/daily-origins";

type ReportsViewProps = {
  cameras?: Camera[];
  enterpriseName: string;
  reportsHistory: ReportRecord[];
  setReportsHistory: Dispatch<SetStateAction<ReportRecord[]>>;
};

export function ReportsView({ enterpriseName, reportsHistory, setReportsHistory }: ReportsViewProps) {
  const workspace = useReportsWorkspace({ enterpriseName, reportsHistory, setReportsHistory });
  return <ReportsWorkspace workspace={workspace} />;
}
function ReportsWorkspace({ workspace }: { workspace: ReturnType<typeof useReportsWorkspace> }) {
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
    handleDownloadReport,
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
    setShowConfirm,
    showConfirm,
    validationError,
  } = workspace;
  const reviewKey = JSON.stringify([period, activeReportId, origins, notes, displayedMetrics.unique, displayedMetrics.counting?.snapshot_version]);
  const previewIsDraft = previewReport?.reportId === (activeReportId ?? "TANAW-DRAFT") && !isReadOnly;
  const previewValidation = previewReport ? ((previewIsDraft ? dailyOriginsError(days) : null) ?? validateDemographicAllocation(previewReport.metrics, previewReport.demo)) : null;
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
          validationMessage={previewValidation}
          onClose={() => {
            if (previewReport.reportId === (activeReportId ?? "TANAW-DRAFT") && !previewValidation && JSON.stringify(previewReport.origins) === JSON.stringify(origins)) setReviewedKey(reviewKey);
            setPreviewReport(null);
          }}
        />
      )}

      {showConfirm && <SubmitReportDialog isSubmitting={isSubmitting} onCancel={() => setShowConfirm(false)} onConfirm={executeSubmit} />}

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
          activeReportId={activeReportId}
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
          onSubmitPrompt={() => setShowConfirm(true)}
          onReview={() =>
            setPreviewReport({
              attractionType,
              demo,
              origins: hasDailyOrigins ? origins : undefined,
              metrics: displayedMetrics,
              notes,
              period,
              reportId: activeReportId ?? "TANAW-DRAFT",
            })
          }
          setOrigins={setOrigins}
          setNotes={setNotes}
        />
      </div>
      <div id="reports-panel-history" role="tabpanel" aria-labelledby="reports-tab-history" hidden={tab !== "history"} className="reports-tab-panel">
        <ReportLedgerTable
          activeLedgerKey={previewedLedgerKey ?? activeLedgerKey}
          ledgerRows={ledgerRows}
          isLoading={isPeriodChanging && !ledgerRows.length}
          onDownloadReport={handleDownloadReport}
          onPreviewReport={handlePreviewReport}
          onSelectReport={(row) => setPreviewedLedgerKey(row.key)}
        />
      </div>
    </div>
  );
}
