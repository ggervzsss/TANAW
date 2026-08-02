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
    <div className="animate-in fade-in space-y-6 font-sans duration-500">
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
