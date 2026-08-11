import type { Dispatch, SetStateAction } from "react";
import { DotFormModal } from "./DotFormModal";
import { ReportDraftPanel } from "./ReportDraftPanel";
import { ReportLedgerTable } from "./ReportLedgerTable";
import { SubmitReportDialog } from "./SubmitReportDialog";
import type { ReportRecord } from "../../../types/enterprise";
import { useReportsWorkspace } from "../hooks/useReportsWorkspace";
import { validateDemographicAllocation } from "../model/report-workspace";

type ReportsViewProps = {
  enterpriseName: string;
  reportsHistory: ReportRecord[];
  setReportsHistory: Dispatch<SetStateAction<ReportRecord[]>>;
};

export function ReportsView({ enterpriseName, reportsHistory, setReportsHistory }: ReportsViewProps) {
  const {
    activeLedgerKey,
    activeReport,
    activeReportId,
    blockingMetricsError,
    demo,
    displayedMetrics,
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
  } = useReportsWorkspace({ enterpriseName, reportsHistory, setReportsHistory });

  return (
    <div className="tanaw-reports-workspace animate-in fade-in space-y-5 font-sans duration-500" data-reports-surface="camera-setup-generation">
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

      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#111827] dark:text-slate-50">Reports</h2>
          <p className="mt-0.5 text-xs font-medium text-gray-500 dark:text-slate-400">Prepare unfinished monthly reports and review submitted report history.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.7fr)]">
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
